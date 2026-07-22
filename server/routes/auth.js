/**
 * Auth routes: register & login for all three roles.
 */
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { get, run, exec } = require('../db');
const { signToken, authRequired } = require('../middleware/auth');
const emailer = require('../email');

const router = express.Router();

const PUBLIC_USER = 'id, name, role, phone, email, language, ward, active, created_at';

// Password-reset tokens live in their own table; create it on first use so it
// works in production (which skips the global schema init).
let resetReady = null;
function ensureResetTable() {
  if (!resetReady) {
    resetReady = exec(`CREATE TABLE IF NOT EXISTS password_resets (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  return resetReady;
}

/**
 * POST /api/auth/forgot { email } — email a password-reset link.
 * Always answers success (never reveals whether an email is registered), except
 * when email delivery isn't configured yet.
 */
router.post('/forgot', async (req, res) => {
  await ensureResetTable();
  const email = (req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email is required' });
  const genericOk = { ok: true, message: 'If that email is registered, a reset link has been sent.' };

  const user = await get(`SELECT id, name, email FROM users WHERE lower(email) = ?`, [email]);
  if (!user || !user.email) return res.json(genericOk); // don't leak account existence
  if (!emailer.isEnabled()) {
    return res.status(503).json({ error: 'Email is not set up yet. Please ask the Nagarpalika admin to reset your password.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes
  await run(`INSERT INTO password_resets (token, user_id, expires_at) VALUES (?,?,?)`, [token, user.id, expires]);

  const base = (process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`).replace(/\/$/, '');
  const link = `${base}/reset?token=${token}`;
  try {
    await emailer.sendEmail({ to: user.email, subject: 'Reset your Kisan Sathi password', html: emailer.resetEmailHtml(user.name, link) });
  } catch (e) {
    console.error('reset email failed:', e.message);
    return res.status(502).json({ error: 'Could not send the email right now. Please try again shortly.' });
  }
  res.json(genericOk);
});

/** POST /api/auth/reset { token, password } — set a new password from a valid link. */
router.post('/reset', async (req, res) => {
  await ensureResetTable();
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'token and password are required' });
  if (String(password).length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const row = await get(`SELECT * FROM password_resets WHERE token = ?`, [token]);
  if (!row || row.used || new Date(row.expires_at) < new Date()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
  }
  await run(`UPDATE users SET password_hash = ? WHERE id = ?`, [bcrypt.hashSync(password, 10), row.user_id]);
  await run(`UPDATE password_resets SET used = 1 WHERE token = ?`, [token]);
  res.json({ ok: true });
});

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
