/**
 * User management. Super admin manages all users; everyone can update own profile.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { get, all, run } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
const PUBLIC_USER = 'id, name, role, phone, email, language, ward, active, created_at';
// Non-sensitive public profile fields (never password_hash).
const PROFILE = 'id, name, role, phone, bio, address, ward, avatar, created_at';

/** GET /api/users/me -> the logged-in user's own profile (editable fields). */
router.get('/me', authRequired, async (req, res) => {
  const user = await get(`SELECT id, name, role, phone, email, language, ward, bio, address, avatar, show_contact, created_at FROM users WHERE id = ?`, [req.user.id]);
  res.json({ user });
});

/**
 * GET /api/users/:id/profile -> ANY logged-in user can view a public profile:
 * who they are + what they sell. Excludes crucial/sensitive data.
 */
router.get('/:id/profile', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  const user = await get(`SELECT ${PROFILE}, show_contact FROM users WHERE id = ?`, [id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Respect the user's privacy choice: hide phone unless they allow it.
  // (Admins viewing always see it.)
  if (!user.show_contact && req.user.role !== 'super_admin' && req.user.id !== id) {
    user.phone = null;
  }
  delete user.show_contact;

  const products = await all(
    `SELECT id, title, category, price, unit, image, status FROM products WHERE seller_id = ? ORDER BY created_at DESC`,
    [id]
  );
  const stats = {
    listings: products.filter((p) => p.status === 'available').length,
    sold: (await get(`SELECT COUNT(*) AS c FROM orders WHERE seller_id = ? AND status = 'completed'`, [id])).c,
  };
  if (user.role === 'expert') {
    user.expert = await get(`SELECT specialization, bio AS expert_bio, verified FROM experts WHERE expert_id = ?`, [id]) || null;
  }
  res.json({ user, products, stats });
});

/** GET /api/users?role=farmer&ward=3  (super admin only) */
router.get('/', authRequired, requireRole('super_admin'), async (req, res) => {
  const { role, ward } = req.query;
  const where = [], params = [];
  if (role) { where.push('role = ?'); params.push(role); }
  if (ward) { where.push('ward = ?'); params.push(Number(ward)); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await all(`SELECT ${PUBLIC_USER} FROM users ${clause} ORDER BY created_at DESC`, params);
  res.json({ users: rows });
});

/** GET /api/users/:id  (self or admin) */
router.get('/:id', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (req.user.role !== 'super_admin' && req.user.id !== id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const user = await get(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`, [id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

/** PATCH /api/users/:id  update name/phone/email/language/password (self or admin) */
router.patch('/:id', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (req.user.role !== 'super_admin' && req.user.id !== id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { name, phone, email, language, password, bio, address, avatar, ward } = req.body || {};
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
  if (email !== undefined) { fields.push('email = ?'); values.push(email); }
  if (language !== undefined) { fields.push('language = ?'); values.push(language); }
  if (ward !== undefined) {
    const w = Number(ward);
    fields.push('ward = ?'); values.push(w >= 1 && w <= 11 ? w : null);
  }
  if (bio !== undefined) { fields.push('bio = ?'); values.push(bio); }
  if (address !== undefined) { fields.push('address = ?'); values.push(address); }
  if (avatar !== undefined) { fields.push('avatar = ?'); values.push(avatar); }
  if (req.body.show_contact !== undefined) { fields.push('show_contact = ?'); values.push(req.body.show_contact ? 1 : 0); }
  if (password) { fields.push('password_hash = ?'); values.push(bcrypt.hashSync(password, 10)); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  values.push(id);
  await run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
  const user = await get(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`, [id]);
  res.json({ user });
});

/** PATCH /api/users/:id/status  enable/disable (admin only) */
router.patch('/:id/status', authRequired, requireRole('super_admin'), async (req, res) => {
  const id = Number(req.params.id);
  const active = req.body && req.body.active ? 1 : 0;
  await run(`UPDATE users SET active = ? WHERE id = ?`, [active, id]);
  res.json({ ok: true, id, active });
});

/** DELETE /api/users/:id  (admin only) */
router.delete('/:id', authRequired, requireRole('super_admin'), async (req, res) => {
  const id = Number(req.params.id);
  await run(`DELETE FROM users WHERE id = ?`, [id]);
  res.json({ ok: true });
});

module.exports = router;
