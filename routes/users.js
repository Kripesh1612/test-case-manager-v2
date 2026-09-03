const express = require('express');
const { validate, asyncHandler } = require('../middleware/http');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const withAudit = require('../middleware/withAudit');
const { updateUserRoleSchema } = require('../shared/schemas/auth');
const { parseId } = require('../utils/params');
const prisma = require('../db');

const router = express.Router();

// All /users routes are admin-only.
router.use(requireAuth, requireRole('admin'));

// LIST USERS — GET /users
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, email: true, name: true, role: true, created_at: true },
    });
    res.json(users);
  })
);

// CHANGE ROLE — PUT /users/:id/role
router.put(
  '/:id/role',
  validate(updateUserRoleSchema),
  withAudit('user.role', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'User not found' });
    const { role } = req.body;
    if (id === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot demote yourself out of admin' });
    }
    const updated = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, email: true, name: true, role: true },
    });
    res.json(updated);
  }, {
    target_type: 'user',
    targetId: (req) => parseId(req.params.id),
    before: (req) => {
      const id = parseId(req.params.id);
      return id
        ? prisma.user.findUnique({
            where: { id },
            select: { id: true, email: true, name: true, role: true },
          })
        : null;
    },
  })
);

// DELETE USER — DELETE /users/:id (hard delete — user accounts are binary)
router.delete(
  '/:id',
  withAudit('user.delete', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'User not found' });
    if (id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete yourself' });
    }
    await prisma.user.delete({ where: { id } });
    res.status(204).send();
  }, {
    target_type: 'user',
    targetId: (req) => parseId(req.params.id),
    before: (req) => {
      const id = parseId(req.params.id);
      return id
        ? prisma.user.findUnique({
            where: { id },
            select: { id: true, email: true, name: true, role: true },
          })
        : null;
    },
  })
);

module.exports = router;