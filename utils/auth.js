const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { getJwtSecret, getJwtExpiresIn } = require('../utils/settings');

// Audit C18: raise bcrypt cost factor from 10 to 12. The hardware
// budget for a single bcrypt.compare on a Xeon-class CPU is roughly:
//   cost 10 →  ~60 ms
//   cost 12 → ~250 ms
// 250 ms / login attempt is still within human-perceptible latency,
// and dramatically raises the cost of offline brute-forcing a stolen
// hash dump. Existing hashes still verify (the salt is encoded in
// each one), so this change is forward-only.
const SALT_ROUNDS = 12;
const JWT_EXPIRES_IN = getJwtExpiresIn();

// Hash a plain-text password using bcrypt
const hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS);

// Audit C2: timing-safe login. When the email isn't in the DB, the
// happy path's bcrypt.compare still needs to run (or a rough equivalent)
// so an attacker can't enumerate emails by measuring response latency.
//
// We synthesize the equivalent run via a pre-computed bcrypt hash of a
// 32-byte throwaway password. The plaintext is generated once per
// process with crypto.randomBytes, hashed, and then forgotten — only
// the hash remains. The hash is NEVER exported: callers invoke
// `timingSafeComparePassword(plain)` and don't need to know which hash
// they're hitting.
//
// The hash is regenerated on each process start, which means there is
// no stable ciphertext that an offline dictionary attack can build up
// across restarts; the attacker would have to re-crack on every
// process boot.
let _dummyHashPromise = null;
const _getDummyHash = () => {
  if (!_dummyHashPromise) {
    const plaintext = crypto.randomBytes(32).toString('hex');
    _dummyHashPromise = bcrypt.hash(plaintext, SALT_ROUNDS).then((h) => {
      // Drop the plaintext reference so it doesn't sit on the heap.
      // (Node won't actively GC the local in the closure, but the
      // closure itself goes away once the promise resolves.)
      return h;
    });
  }
  return _dummyHashPromise;
};

const timingSafeComparePassword = async (plain) => {
  const hash = await _getDummyHash();
  // The result is intentionally discarded — login only cares that the
  // branch took ~250 ms; the boolean answer has no useful meaning
  // against a throwaway hash.
  await bcrypt.compare(plain, hash);
};

// Sign a JWT containing the user's id and role.
// Audit C16: pin the verification algorithm to HS256 on the verify
// side (see middleware/auth.js). The sign side alg pin is belt-and-
// braces for symmetry — jsonwebtoken's default is HS256 when the
// secret is symmetric, but writing it explicitly forecloses any
// "what if the secret flipped to public key" future path.
const generateToken = (userId, role) =>
  jwt.sign({ userId, role }, getJwtSecret(), {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: 'HS256',
  });

module.exports = {
  hashPassword,
  timingSafeComparePassword,
  generateToken,
};
