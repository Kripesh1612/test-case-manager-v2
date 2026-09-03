// MUST be required as the very first import of `index.js`, before any
// module that reads `process.env` at load time.
//
// Background: `utils/auth.js` reads `JWT_SECRET` at module-load to sign
// tokens, and `middleware/auth.js` reads it to verify tokens. Without this
// shim, the two read process.env at *different* times — `utils/auth.js`
// before Prisma has loaded the .env file, `middleware/auth.js` after —
// which means signing uses the fallback `'dev-secret-change-me'` while
// verification uses the real value from .env. Today both fall back to the
// same default so it works, but adding `JWT_SECRET=` to `.env` would
// silently break every login with a 401. This shim fixes that.
//
// Node 22+ has `process.loadEnvFile`; older versions fall back to a small
// manual parser.

const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '.env');

if (fs.existsSync(envPath)) {
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(envPath);
    } catch (_) {
      // .env unreadable; keep whatever's in process.env
    }
  } else {
    // Manual fallback for Node < 20.12.
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        let v = m[2] || '';
        // Strip surrounding quotes if present.
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        process.env[m[1]] = v;
      }
    }
  }
}