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
// Defaults below are the **production** values: 10 login attempts and
// 3 register attempts per minute per IP. Both are sane caps for a
// headless deployment. The two slack knobs in front of them are:
//
//   RATE_LIMIT_BURST=1   - relax to the "Cypress-friendly" 200 caps so
//                          a fast CI sweep (e2e + UI specs register a
//                          burst of users in seconds) doesn't trip the
//                          limiter. The deployer opts in explicitly.
//
//   RATE_LIMIT_LOGIN_MAX / RATE_LIMIT_REGISTER_MAX
//                        - explicit override on top of either mode.
//
// The auto-burst rule: if neither RATE_LIMIT_LOGIN_MAX nor
// RATE_LIMIT_REGISTER_MAX is set, AND RATE_LIMIT_BURST is unset, we
// default to the strict production caps. Setting RATE_LIMIT_BURST=1
// flips to the 200/200 generous defaults that the Cypress suite needs.
// Setting RATE_LIMIT_LOGIN_MAX or RATE_LIMIT_REGISTER_MAX to a
// specific value always wins.

const STRICT_LOGIN_MAX = 10;
const STRICT_REGISTER_MAX = 3;
const BURST_LOGIN_MAX = 200;
const BURST_REGISTER_MAX = 200;

const isBurst = () => {
  const b = process.env.RATE_LIMIT_BURST;
  if (b == null) return false;
  return b.toLowerCase() === '1' || b.toLowerCase() === 'true' || b.toLowerCase() === 'yes';
};

const getRateLimitLoginMax = () => {
  const n = parseInt(process.env.RATE_LIMIT_LOGIN_MAX, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return isBurst() ? BURST_LOGIN_MAX : STRICT_LOGIN_MAX;
};

const getRateLimitRegisterMax = () => {
  const n = parseInt(process.env.RATE_LIMIT_REGISTER_MAX, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return isBurst() ? BURST_REGISTER_MAX : STRICT_REGISTER_MAX;
};

// --- Audit enabled? ---

const isAuditEnabled = () =>
  (process.env.AUDIT_ENABLED || 'true').toLowerCase() !== 'false';

// --- Webhooks ---

const DEFAULT_WEBHOOK_TIMEOUT_MS = 5000;
const DEFAULT_WEBHOOK_RETRIES = 2;

const getWebhookTimeoutMs = () => {
  const n = parseInt(process.env.WEBHOOK_TIMEOUT_MS, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WEBHOOK_TIMEOUT_MS;
};

const getWebhookRetries = () => {
  const n = parseInt(process.env.WEBHOOK_RETRIES, 10);
  return Number.isFinite(n) && n >= 0 && n <= 10 ? n : DEFAULT_WEBHOOK_RETRIES;
};

const getWebhookEnabled = () =>
  (process.env.WEBHOOKS_ENABLED || 'true').toLowerCase() !== 'false';

// --- Email digest ---

const getDigestEnabled = () =>
  (process.env.DIGEST_ENABLED || 'false').toLowerCase() !== 'false';

const getDigestSchedule = () => process.env.DIGEST_SCHEDULE || '0 8 * * *'; // daily 08:00 UTC

const getDigestRecipients = () =>
  (process.env.DIGEST_RECIPIENTS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

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
  getWebhookTimeoutMs,
  getWebhookRetries,
  getWebhookEnabled,
  getDigestEnabled,
  getDigestSchedule,
  getDigestRecipients,
};