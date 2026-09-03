// Backwards-compatible shim. The real logic lives in utils/env.js so that
// it can be loaded lazily and shared with every other file that needs env.
const { getAdminEmails, isAdminEmail } = require('./env');

module.exports = { adminEmails: getAdminEmails, isAdminEmail };
