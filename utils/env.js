// Backwards-compatible shim. The real logic lives in utils/settings.js,
// which loads lazily so .env values are always populated (assuming
// config.js was required first from index.js).
//
// All callers should prefer utils/settings.js directly; this file exists
// only so older imports of utils/env keep working.

module.exports = require('./settings');