// /invites — invite-only registration.
//
// Workflow:
//   1. Admin POSTs /invites with { email, role } → gets back
//      { id, token, accept_url, expires_at }.
//   2. The accept_url is sent to the invitee (email/Slack/etc — out of
//      scope for this codebase). They open it; /invite-redeem.html
//      collects name + password and POSTs /invites/redeem.
//   3. /invites/redeem validates the token, ensures the email matches
//      the one on the invite, creates the user, and stamps accepted_at.

const crypto = require('crypto');
const express = require('express');
const { asyncHandler, validate } = require('../middleware/http');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const withAudit = require('../middleware/withAudit');
const { getInviteTtlDays } = require('../utils/settings');
const { parseId } = require('../utils/params');
const { hashPassword } = require('../utils/auth');
const { withProjectName } = require('./projects');
const { inviteCreateSchema } = require('../shared/schemas/auth');
const prisma = require('../db');

const router = express.Router();

// List invites — admin only. Optional ?status=pending|accepted|expired.
router.get(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const where = { project_id: req.user.projectId };
    if (req.query.status === 'pending') {
      where.accepted_at = null;
      where.expires_at = { gt: new Date() };
    } else if (req.query.status === 'accepted') {
      where.accepted_at = { not: null };
    } else if (req.query.status === 'expired') {
      where.accepted_at = null;
      where.expires_at = { lte: new Date() };
    }
    const rows = await prisma.invite.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 200,
      include: {
        created_by: { select: { id: true, email: true, name: true, role: true } },
      },
    });
    res.json({ count: rows.length, invites: rows });
  })
);

// Create invite — admin only.
router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  // Audit C (validation): Zod now checks email/role/project_id types
  // and length caps. The old code accepted a 1-MB email string and
  // forwarded NaN from `parseInt(project_id)` to Prisma.
  validate(inviteCreateSchema),
  withAudit('invite.create', async (req, res) => {
    const { email, role, project_id } = req.body;
    // Invite lands in the admin's active project by default; the client
    // can over-ride with an explicit project_id (validated to exist).
    let targetProject = req.user.projectId;
    if (project_id !== undefined) {
      const project = await prisma.project.findUnique({ where: { id: project_id } });
      if (!project) return res.status(400).json({ error: 'project_id does not reference a project' });
      targetProject = project_id;
    }
    const ttlDays = getInviteTtlDays();
    const token = crypto.randomBytes(32).toString('hex');
    const expires_at = new Date(Date.now() + ttlDays * 86400000);

    const invite = await prisma.invite.create({
      data: {
        email,
        role: role || 'editor',
        project_id: targetProject,
        token,
        expires_at,
        created_by_id: req.user.id,
      },
    });
    res.status(201).json({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      token: invite.token,
      accept_url: `/invite-redeem?token=${invite.token}`,
      expires_at: invite.expires_at,
    });
  }, {
    target_type: 'invite',
    targetId: (_req, captured) => (captured && captured.id) || null,
    // CRITICAL: do NOT audit the response body verbatim. The plaintext
    // `token` field is a one-shot bearer credential — it lands in the
    // response so the admin can hand it to the invitee, but it must
    // never be persisted. Audit only the row's identifying fields plus
    // a fingerprint of the token (first 8 chars + '…') so admins can
    // still tell invites apart in the audit log without leaking the
    // secret material.
    after: (_req, captured) => {
      if (!captured || typeof captured !== 'object') return null;
      const tok = captured.token || '';
      return {
        id: captured.id,
        email: captured.email,
        role: captured.role,
        expires_at: captured.expires_at,
        token_fingerprint: tok ? `${tok.slice(0, 8)}…` : null,
      };
    },
  })
);

// Redeem invite — public (no auth). Body: { token, name, password }.
router.post(
  '/redeem',
  asyncHandler(async (req, res) => {
    const { token, name, password } = req.body || {};
    if (!token || !name || !password) {
      return res.status(400).json({ error: 'token, name, and password are required' });
    }
    const invite = await prisma.invite.findUnique({ where: { token } });
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    if (invite.accepted_at) return res.status(410).json({ error: 'Invite already used' });
    if (invite.expires_at < new Date()) return res.status(410).json({ error: 'Invite has expired' });

    // Use the invite's stored email — don't trust the client's email
    // (it could differ from the invited address).
    const existing = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    // bcrypt.hash takes ~250 ms and isn't part of the DB transaction,
    // so we run it before opening the transaction. The transaction
    // then commits user-create + invite-accepted-stamp atomically.
    const password_hash = await hashPassword(password);

    // Audit C5 — atomic redeem:
    // Two clients hitting `Accept` simultaneously could otherwise both
    // pass the `accepted_at IS NULL` check above, both create a user
    // (only one winning on the email unique — confusing 409 on a
    // happy-path flow), and race on stamping accepted_at. The unique
    // constraint on User.email gives us partial safety, but we also
    // want the invite state transition to commit atomically.
    //
    // We use `update` (which throws P2025 on a missing/stale row)
    // rather than `updateMany` so the transaction aborts cleanly if
    // a concurrent redeem beat us to the punch.
    let user;
    try {
      user = await prisma.$transaction(async (tx) => {
        // The compound `accepted_at: null, expires_at: gt now` clause
        // isn't a unique constraint, so prisma.update can't enforce
        // it. We use updateMany + count = 1 as the atomic claim: if a
        // concurrent redeem already flipped accepted_at, the count is
        // 0 and we abort the transaction by throwing.
        const claim = await tx.invite.updateMany({
          where: {
            id: invite.id,
            accepted_at: null,
            expires_at: { gt: new Date() },
          },
          data: { accepted_at: new Date() },
        });
        if (claim.count !== 1) {
          const err = new Error('invite was claimed by a concurrent request');
          err.code = 'P2025';
          throw err;
        }
        return tx.user.create({
          data: {
            email: invite.email,
            password_hash,
            name,
            role: invite.role,
            // Feature 4: redeem drops the user into the invite's project.
            project_id: invite.project_id || 1,
          },
        });
      });
    } catch (e) {
      // P2025 from the update → a concurrent caller already accepted it.
      if (e && e.code === 'P2025') {
        return res.status(410).json({ error: 'Invite already used' });
      }
      // P2002 from the user create → duplicate email, even though our
      // pre-check thought we were clear. Surface the standard message.
      if (e && e.code === 'P2002') {
        return res.status(409).json({ error: 'Email already registered' });
      }
      throw e;
    }

    // Issue a JWT so the user is logged in immediately.
    const { generateToken } = require('../utils/auth');
    const jwt = generateToken(user.id, user.role);

    const enriched = await withProjectName({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      projectId: user.project_id,
    });

    res.status(201).json({
      user: enriched,
      token: jwt,
    });
  })
);

// Revoke invite — admin only. Hard delete; the token is unusable
// because it no longer exists.
router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  withAudit('invite.revoke', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Invite not found' });
    const result = await prisma.invite.deleteMany({ where: { id, project_id: req.user.projectId } });
    if (result.count === 0) return res.status(404).json({ error: 'Invite not found' });
    res.status(204).send();
  }, {
    target_type: 'invite',
    targetId: (req) => parseId(req.params.id),
  })
);

module.exports = router;