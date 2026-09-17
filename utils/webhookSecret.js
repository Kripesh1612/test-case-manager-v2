// utils/webhookSecret.js — encrypt/decrypt webhook HMAC secrets at rest.
//
// Why a separate module? Webhooks are the only column in the schema where
// the value cannot be hashed (HMAC verification needs the raw secret at
// sign time). Storing it plaintext in Postgres means any DB leak —
// backup theft, read-replica compromise, SQL injection — hands an
// attacker every customer's signing key.
//
// Approach:
//   - AES-256-GCM with a key derived from JWT_SECRET via SHA-256
//     (`JWT_SECRET` is already required to be 32+ bytes in production;
//     we never want a separate KMS dependency just for this column).
//   - Stored representation is a string: `enc:v1:<iv_b64>:<tag_b64>:<ct_b64>`
//     so we can rotate the algorithm later without a migration.
//   - Empty secrets round-trip as empty strings (a webhook with no
//     secret is unsigned by design — see utils/webhooks.js).
//   - Plaintext (unprefixed) values are accepted on decrypt and returned
//     as-is. This lets the migration run while old rows still hold
//     plaintext — write paths re-encrypt on next save. Don't expose this
//     fallback to anything that takes user input directly; it's a
//     migration courtesy.

const crypto = require('crypto');
const { getJwtSecret } = require('./settings');

const PREFIX = 'enc:v1:';

const deriveKey = () => crypto.createHash('sha256').update(getJwtSecret(), 'utf8').digest();

const encryptSecret = (plaintext) => {
  if (plaintext === '' || plaintext === null || plaintext === undefined) return '';
  if (typeof plaintext !== 'string') plaintext = String(plaintext);
  if (plaintext.startsWith(PREFIX)) return plaintext; // already encrypted
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
};

const decryptSecret = (stored) => {
  if (stored === '' || stored === null || stored === undefined) return '';
  if (typeof stored !== 'string') stored = String(stored);
  if (!stored.startsWith(PREFIX)) return stored; // migration fallback
  const rest = stored.slice(PREFIX.length);
  const parts = rest.split(':');
  if (parts.length !== 3) return '';
  const [iv_b64, tag_b64, ct_b64] = parts;
  let iv, tag, ct;
  try {
    iv = Buffer.from(iv_b64, 'base64');
    tag = Buffer.from(tag_b64, 'base64');
    ct = Buffer.from(ct_b64, 'base64');
  } catch (_) {
    return '';
  }
  if (iv.length !== 12 || tag.length !== 16 || ct.length === 0) return '';
  const key = deriveKey();
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch (_) {
    // Tag mismatch / corruption — return empty so the webhook signs
    // nothing rather than producing a wrong-but-plausible signature.
    return '';
  }
};

module.exports = { encryptSecret, decryptSecret };
