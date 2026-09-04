// Lazy access to env-derived settings.
//
// All helpers in this file read process.env inside the function body —
// never at module-load. Combined with config.js (which is required first
// from index.js to load .env), this means every env read happens at a
// deterministic time with .env already populated.
//
// Why lazy? Two reasons:
//   1. process.env reads at module load race against .env loading. See
//      config.js for the long version.
//   2. Tests can mutate process.env before calling these functions and
//      see the change reflected immediately.

const DEFAULT_JWT_SECRET = 'dev-secret-change-me';
const DEFAULT_INVITE_TTL_DAYS = 7;
const DEFAULT_TRASH_RETENTION_DAYS = 30;
const VALID_REGISTRATION_MODES = ['open', 'invite'];
const VALID_AUDIT_MODES = ['true', 'false'];

// --- JWT ---

const getJwtSecret = () => process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

// --- Admin emails ---

const getAdminEmails = () =>
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const isAdminEmail = (email) =>
  getAdminEmails().includes(String(email || '').toLowerCase());

// --- Registration mode ---
// "open"   -> anyone can POST /auth/register (default; learning-friendly)
// "invite" -> registration requires a valid invite token (except for
//             bootstrap cases — see middleware/registrationMode.js)

const getRegistrationMode = () => {
  const m = (process.env.REGISTRATION_MODE || 'open').toLowerCase();
  return VALID_REGISTRATION_MODES.includes(m) ? m : 'open';
};

// --- Invite TTL (days) ---

const getInviteTtlDays = () => {
  const n = parseInt(process.env.INVITE_TTL_DAYS, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INVITE_TTL_DAYS;
};

// --- Trash retention (days; 0 = never auto-purge) ---

const getTrashRetentionDays = () => {
  const n = parseInt(process.env.TRASH_RETENTION_DAYS, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TRASH_RETENTION_DAYS;
};

// --- Rate limit caps (requests per 60s window per IP) ---
//
// Defaults are deliberately generous so the Cypress suite isn't tripped
// during a fast CI run (the API suite alone does ~17 fresh registrations
// in a row, and UI specs add more on top). For production deployments,
// tighten via env:
//   RATE_LIMIT_LOGIN_MAX=10      RATE_LIMIT_REGISTER_MAX=3

const DEFAULT_RATE_LIMIT_LOGIN_MAX = 200;
const DEFAULT_RATE_LIMIT_REGISTER_MAX = 200;

const getRateLimitLoginMax = () => {
  const n = parseInt(process.env.RATE_LIMIT_LOGIN_MAX, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RATE_LIMIT_LOGIN_MAX;
};

const getRateLimitRegisterMax = () => {
  const n = parseInt(process.env.RATE_LIMIT_REGISTER_MAX, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RATE_LIMIT_REGISTER_MAX;
};

// --- Audit enabled? ---

const isAuditEnabled = () =>
  (process.env.AUDIT_ENABLED || 'true').toLowerCase() !== 'false';

module.exports = {
  getJwtSecret,
  getAdminEmails,
  isAdminEmail,
  getRegistrationMode,
  getInviteTtlDays,
  getTrashRetentionDays,
  getRateLimitLoginMax,
  getRateLimitRegisterMax,
  isAuditEnabled,
};