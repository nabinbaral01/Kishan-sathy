/**
 * Notifications: rain / pest / fertilizer / harvest / general alerts.
 * user_id NULL => broadcast (visible to everyone). Admin can create/broadcast.
 */
const express = require('express');
const { get, all, run } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/notifications -> notifications for the current user.
 *  - experts: ONLY notifications addressed to them (broadcasts are farmer alerts)
 *  - farmers/admin: personal notifications + broadcasts (user_id IS NULL)
 */
router.get('/', authRequired, async (req, res) => {
  const rows = req.user.role === 'expert'
    ? await all(
        `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
        [req.user.id]
      )
    : await all(
        `SELECT * FROM notifications WHERE user_id IS NULL OR user_id = ? ORDER BY created_at DESC LIMIT 100`,
        [req.user.id]
      );
  res.json({ notifications: rows });
});

/** GET /api/notifications/unread-count -> personal unread count (for the badge) */
router.get('/unread-count', authRequired, async (req, res) => {
  const row = await get(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0`, [req.user.id]);
  res.json({ count: row.c });
});

/** POST /api/notifications/read-all -> mark this user's notifications read */
router.post('/read-all', authRequired, async (req, res) => {
  await run(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`, [req.user.id]);
  res.json({ ok: true });
});

/**
 * POST /api/notifications  { type, title, message, user_id? }  (admin)
 * Omit user_id to broadcast.
 */
router.post('/', authRequired, requireRole('super_admin'), async (req, res) => {
  const { type, title, message, user_id } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  const allowed = ['rain', 'pest', 'fertilizer', 'harvest', 'general'];
  const info = await run(
    `INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)`,
    [user_id || null, allowed.includes(type) ? type : 'general', title, message || null]
  );
  res.status(201).json({ notification: await get(`SELECT * FROM notifications WHERE id = ?`, [info.lastInsertRowid]) });
});

/** PATCH /api/notifications/:id/read */
router.patch('/:id/read', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  const n = await get(`SELECT * FROM notifications WHERE id = ?`, [id]);
  if (!n) return res.status(404).json({ error: 'Not found' });
  if (n.user_id && n.user_id !== req.user.id && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await run(`UPDATE notifications SET is_read = 1 WHERE id = ?`, [id]);
  res.json({ ok: true });
});

module.exports = router;
