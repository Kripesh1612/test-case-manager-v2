// =============================================================================
// requireOwnership — editor-only mutation guard.
//
// The data model records a row's creator (TestCase.created_by_id) so we
// can enforce "editors can only mutate resources they created". Admins
// bypass the check; viewers can't get this far because requireRole
// already blocks them.
//
// Usage:
//   router.put('/:id', requireAuth, requireRole('admin', 'editor'),
//     requireOwnership({ model: 'testCase' }),
//     withAudit('test_case.update', async (req, res) => { ... }));
//
// Options:
//   model     Prisma model name (required). The route id comes from
//             req.params.id and is parsed via utils/params.parseId.
//   idParam   Name of the param holding the id (default 'id').
//
// On success: `req.ownership.row` carries the loaded row so the
// downstream handler doesn't need to re-fetch.
//
// On failure modes:
//   - Invalid / missing id        → 404
//   - Row doesn't exist / deleted → 404
//   - Row has no created_by_id    → 403 (legacy / server-seeded rows
//                                   are read-only for editors)
//   - Caller isn't the creator    → 403
//   - Caller is admin             → always allowed
// =============================================================================

const { parseId } = require('../utils/params');
const { NOT_DELETED } = require('../utils/scope');
const prisma = require('../db');

const requireOwnership = ({ model, idParam = 'id' } = {}) => {
  if (!model) {
    throw new Error('requireOwnership: `model` is required');
  }
  if (!prisma[model]) {
    throw new Error(`requireOwnership: unknown Prisma model "${model}"`);
  }
  return async (req, res, next) => {
    try {
      // Admins bypass the check entirely.
      if (req.user && req.user.role === 'admin') {
        // Still load the row so downstream handlers can use req.ownership.row.
        const id = parseId(req.params[idParam]);
        if (!id) return res.status(404).json({ error: 'Not found' });
        const row = await prisma[model].findFirst({ where: { id, ...NOT_DELETED } });
        if (!row) return res.status(404).json({ error: 'Not found' });
        req.ownership = { row, bypassed: 'admin' };
        return next();
      }

      const id = parseId(req.params[idParam]);
      if (!id) return res.status(404).json({ error: 'Not found' });

      const row = await prisma[model].findFirst({
        where: { id, ...NOT_DELETED },
        select: { id: true, created_by_id: true },
      });
      if (!row) return res.status(404).json({ error: 'Not found' });

      const userId = req.user?.id;
      // `== null` (not `=== null`) on purpose: matches both null AND
      // undefined. `created_by_id` is set by the route handler, but a
      // legacy row that bypassed it can have undefined/null both.
      // eslint-disable-next-line eqeqeq
      if (row.created_by_id == null) {
        // Legacy or server-seeded row — treat as "no recorded owner".
        // Editors can't mutate it; only admins (handled above) can.
        return res.status(403).json({
          error: 'This row has no recorded owner. Ask an admin to update it.',
        });
      }
      if (!Number.isInteger(userId) || row.created_by_id !== userId) {
        return res.status(403).json({ error: 'You can only modify resources you created.' });
      }

      req.ownership = { row, bypassed: null };
      next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = requireOwnership;
