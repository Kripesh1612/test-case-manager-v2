// /audit — admin-only listing of every mutation recorded by middleware/withAudit.
//
// Query parameters (all optional):
//   actor_id      filter by who did it
//   target_type   "test_case" | "test_suite" | "user" | "invite" | "run" | "system"
//   target_id     numeric id of the affected row
//   action        e.g. "test_case.create", "user.role"
//   limit         default 50, clamped to 1..500
//   offset        default 0

const express = require('express');
const { asyncHandler } = require('../middleware/http');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const prisma = require('../db');

const router = express.Router();

// Everything under /audit is admin-only.
router.use(requireAuth, requireRole('admin'));

const clampInt = (raw, lo, hi, dflt) => {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

// Normalize the metadata column. Jsonb on Postgres returns a parsed object;
// the string branch is a safety net for any legacy row that might have
// slipped in before the Jsonb migration.
const normalizeMeta = (m) => {
  if (m == null) return {};
  if (typeof m === 'object') return m;
  try { return JSON.parse(m); } catch (_) { return {}; }
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const where = {};
    if (req.query.actor_id) where.actor_id = clampInt(req.query.actor_id, 1, 1e9, 1);
    if (req.query.target_type) where.target_type = String(req.query.target_type);
    if (req.query.target_id) where.target_id = clampInt(req.query.target_id, 1, 1e9, 1);
    if (req.query.action) where.action = String(req.query.action);

    const limit = clampInt(req.query.limit, 1, 500, 50);
    const offset = clampInt(req.query.offset, 0, 1e9, 0);

    const [total, rows] = await Promise.all([
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
        include: {
          actor: { select: { id: true, email: true, name: true, role: true } },
        },
      }),
    ]);

    const events = rows.map((e) => {
      const meta = normalizeMeta(e.metadata);
      return {
        id: e.id,
        action: e.action,
        target_type: e.target_type,
        target_id: e.target_id,
        actor: e.actor,
        ip: e.ip,
        user_agent: e.user_agent,
        before: meta.before ?? null,
        after: meta.after ?? null,
        created_at: e.created_at,
      };
    });

    res.json({ total, limit, offset, events });
  })
);

// Optional convenience: distinct action list, to populate a filter dropdown.
router.get(
  '/actions',
  asyncHandler(async (req, res) => {
    const rows = await prisma.auditEvent.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    res.json({ actions: rows.map((r) => r.action) });
  })
);

module.exports = router;