const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('./env');

const SALT_ROUNDS = 10;
const JWT_EXPIRES_IN = '7d';

// Hash a plain-text password using bcrypt
const hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS);

// Sign a JWT containing the user's id and role
const generateToken = (userId, role) =>
  jwt.sign({ userId, role }, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });

module.exports = { hashPassword, generateToken };
