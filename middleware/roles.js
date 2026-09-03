// Role-based access control middleware.
// Use AFTER requireAuth so req.user is populated.
//
//   router.post('/', requireAuth, requireRole('admin', 'editor'), handler)
//
// viewer  → read-only
// editor  → read + write own resources
// admin   → everything, including user management

const requireRole = (...allowed) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({
      error: `Forbidden — role "${req.user.role}" cannot perform this action`,
    });
  }
  next();
};

module.exports = requireRole;
