/**
 * Auth routes: register & login for all three roles.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { get, run } = require('../db');
const { signToken, authRequired } = require('../middleware/auth');

const router = express.Router();

const PUBLIC_USER = 'id, name, role, phone, email, language, ward, active, created_at';

/** POST /api/auth/register  { name, role, phone, email, password, language, ward, specialization } */
router.post('/register', async (req, res) => {
  const { name, role, phone, email, password, language, ward, specialization, bio } = req.body || {};

  if (!name || !password) {
    return res.status(400).json({ error: 'name and password are required' });
  }
  if (!phone && !email) {
    return res.status(400).json({ error: 'phone or email is required' });
  }
  const allowedRoles = ['farmer', 'expert', 'super_admin'];
  const finalRole = allowedRoles.includes(role) ? role : 'farmer';

  try {
    const hash = bcrypt.hashSync(password, 10);
    // Ward only applies to farmers; store 1–11 if valid, else null.
    const wardNum = Number(ward);
    const wardVal = finalRole === 'farmer' && wardNum >= 1 && wardNum <= 11 ? wardNum : null;
    const info = await run(
      `INSERT INTO users (name, role, phone, email, password_hash, language, ward)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, finalRole, phone || null, email || null, hash, language || 'en', wardVal]
    );

    if (finalRole === 'expert') {
      await run(
        `INSERT INTO experts (expert_id, specialization, bio) VALUES (?, ?, ?)`,
        [info.lastInsertRowid, specialization || 'General Agriculture', bio || null]
      );
    }

    const user = await get(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`, [
      info.lastInsertRowid,
    ]);
    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Phone or email already registered' });
    }
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/auth/login  { identifier (phone or email), password } */
router.post('/login', async (req, res) => {
  const { identifier, phone, email, password } = req.body || {};
  const login = identifier || phone || email;
  if (!login || !password) {
    return res.status(400).json({ error: 'identifier and password are required' });
  }

  const user = await get(`SELECT * FROM users WHERE phone = ? OR email = ?`, [login, login]);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!user.active) {
    return res.status(403).json({ error: 'Account disabled. Contact admin.' });
  }

  const token = signToken(user);
  delete user.password_hash;
  res.json({ token, user });
});

/** GET /api/auth/me  -> current profile */
router.get('/me', authRequired, async (req, res) => {
  const user = await get(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`, [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.role === 'expert') {
    user.expert = await get(`SELECT * FROM experts WHERE expert_id = ?`, [user.id]);
  }
  res.json({ user });
});

module.exports = router;
