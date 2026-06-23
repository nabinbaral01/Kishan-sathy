/**
 * Authentication & authorization middleware.
 */
const jwt = require('jsonwebtoken');
const { get } = require('../db');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'kisan-sathi-dev-secret-change-me';

/** Sign a JWT for a user row. */
function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

/** Require a valid bearer token. Attaches req.user = { id, role, name }. */
async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // Ensure the account still exists (e.g. after a DB re-seed the id may be gone).
  // This prevents valid-looking tokens from causing foreign-key failures later.
  const account = await get(`SELECT id, role, name, active FROM users WHERE id = ?`, [payload.id]);
  if (!account || !account.active) {
    return res.status(401).json({ error: 'Session expired — please log in again' });
  }
  req.user = { id: account.id, role: account.role, name: account.name };
  next();
}

/** Restrict a route to one or more roles. Use after authRequired. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

module.exports = { signToken, authRequired, requireRole, JWT_SECRET };
