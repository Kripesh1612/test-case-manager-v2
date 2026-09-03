// registrationGate — when REGISTRATION_MODE=invite, only callers carrying
// a valid invite token can register. Bootstrap escape hatches:
//   - the very first user (no users in the DB yet)
//   - any email listed in ADMIN_EMAILS
// …are always allowed, so a learner following the README never gets
// locked out.
//
// In "open" mode (the learning-friendly default) this is a no-op.
//
// See docs/invites.md.

const prisma = require('../db');
const { getRegistrationMode, isAdminEmail } = require('../utils/settings');

const registrationGate = async (req, res, next) => {
  if (getRegistrationMode() !== 'invite') return next();

  // Bootstrap: zero users yet, or this email is in ADMIN_EMAILS
  const userCount = await prisma.user.count();
  if (userCount === 0) return next();
  if (isAdminEmail(req.body && req.body.email)) return next();

  const token = (req.body && req.body.invite_token) || null;
  if (!token) {
    return res.status(403).json({
      error: 'Registration is invite-only. Provide an invite_token.',
    });
  }

  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite) {
    return res.status(403).json({ error: 'Invalid invite token' });
  }
  if (invite.accepted_at) {
    return res.status(403).json({ error: 'Invite already used' });
  }
  if (invite.expires_at < new Date()) {
    return res.status(403).json({ error: 'Invite has expired' });
  }

  // The register handler must also check that the invite's email matches
  // req.body.email — otherwise anyone with a token could create an account
  // under a different address. The handler enforces that.
  req.invite = invite;
  next();
};

module.exports = registrationGate;