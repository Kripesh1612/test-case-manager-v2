const express = require('express');
const bcrypt = require('bcrypt');
const { validate, asyncHandler } = require('../middleware/http');
const { registerSchema, loginSchema } = require('../shared/schemas/auth');
const { hashPassword, generateToken } = require('../utils/auth');
const { isAdminEmail } = require('../utils/adminEmails');
const requireAuth = require('../middleware/auth');
const registrationGate = require('../middleware/registrationGate');
const prisma = require('../db');

const router = express.Router();

// REGISTER — POST /auth/register
router.post(
  '/register',
  registrationGate,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { email, password, name } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // In invite mode, the email on the invite must match. (registrationGate
    // already verified the token's validity + not-expired; here we ensure
    // you can't use someone else's invite.)
    if (req.invite && req.invite.email && req.invite.email !== email) {
      return res.status(403).json({
        error: 'Invite was issued for a different email address',
      });
    }

    const password_hash = await hashPassword(password);

    // Bootstrap: if the email is in ADMIN_EMAILS, create them as admin
    const role = isAdminEmail(email) ? 'admin' : 'editor';

    const user = await prisma.user.create({
      data: {
        email,
        password_hash,
        name: name || '',
        role,
      },
    });

    const token = generateToken(user.id, user.role);

    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
    });
  })
);

// LOGIN — POST /auth/login
router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user.id, user.role);

    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
    });
  })
);

// ME — GET /auth/me (protected)
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
