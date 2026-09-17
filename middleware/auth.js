const jwt = require('jsonwebtoken');
const prisma = require('../db');
const { getJwtSecret } = require('../utils/env');

// Middleware: require a valid Bearer token, attach user to req.user
const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  try {
    // Audit C16: pin the accept algorithm. Without `algorithms`, jsonwebtoken
    // honours whatever `alg` header the token carries, which historically
    // created confusion-attack surface (alg:none / RS256-as-HS256). The
    // sign side already uses algorithm: 'HS256', so this is symmetric.
    const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role, projectId: user.project_id };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = requireAuth;
