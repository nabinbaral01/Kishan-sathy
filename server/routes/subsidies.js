/**
 * Subsidy / अनुदान management.
 * Farmers apply for government support (seed, fertilizer, equipment…); the
 * municipality (super admin) reviews, approves/rejects and tracks distribution.
 */
const express = require('express');
const { get, all, run } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

const TYPES = ['seed', 'fertilizer', 'equipment', 'polyhouse', 'irrigation', 'livestock', 'training', 'other'];
const STATUSES = ['pending', 'approved', 'rejected', 'distributed'];

/** GET /api/subsidies — admin: all (filter ?status=&ward=); farmer: own. */
router.get('/', authRequired, async (req, res) => {
  if (req.user.role === 'super_admin') {
    const { status, ward } = req.query;
    const where = [], params = [];
    if (status && STATUSES.includes(status)) { where.push('s.status = ?'); params.push(status); }
    if (ward) { where.push('u.ward = ?'); params.push(Number(ward)); }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await all(
      `SELECT s.*, u.name AS farmer_name, u.phone AS farmer_phone, u.ward AS ward
         FROM subsidies s JOIN users u ON u.id = s.farmer_id ${clause}
        ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.created_at DESC`,
      params
    );
    return res.json({ subsidies: rows });
  }
  const rows = await all(`SELECT * FROM subsidies WHERE farmer_id = ? ORDER BY created_at DESC`, [req.user.id]);
  res.json({ subsidies: rows });
});

/** GET /api/subsidies/summary (admin) — counts by status/type/ward. */
router.get('/summary', authRequired, requireRole('super_admin'), async (_req, res) => {
  const byStatus = await all(`SELECT status, COUNT(*) c FROM subsidies GROUP BY status`);
  const byType = await all(`SELECT type, COUNT(*) c FROM subsidies GROUP BY type ORDER BY c DESC`);
  const pending = (await get(`SELECT COUNT(*) c FROM subsidies WHERE status = 'pending'`)).c;
  res.json({ byStatus, byType, pending });
});

/** POST /api/subsidies — farmer applies. */
router.post('/', authRequired, requireRole('farmer'), async (req, res) => {
  const b = req.body || {};
  const type = TYPES.includes(b.type) ? b.type : 'other';
  const title = (b.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Please describe what you need' });
  const amount = b.amount != null && b.amount !== '' ? Number(b.amount) : null;
  const info = await run(
    `INSERT INTO subsidies (farmer_id, type, title, details, amount) VALUES (?,?,?,?,?)`,
    [req.user.id, type, title, (b.details || '').trim() || null, amount]
  );
  res.status(201).json({ subsidy: await get(`SELECT * FROM subsidies WHERE id = ?`, [info.lastInsertRowid]) });
});

/** PATCH /api/subsidies/:id — admin decides. */
router.patch('/:id', authRequired, requireRole('super_admin'), async (req, res) => {
  const id = Number(req.params.id);
  const sub = await get(`SELECT * FROM subsidies WHERE id = ?`, [id]);
  if (!sub) return res.status(404).json({ error: 'Application not found' });
  const status = req.body && req.body.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  await run(
    `UPDATE subsidies SET status = ?, admin_note = ?, decided_at = datetime('now') WHERE id = ?`,
    [status, (req.body.admin_note || '').trim() || null, id]
  );
  // Keep the Nagarpalika beneficiary registry in sync with this decision
  // (approved/distributed -> recorded; rejected/pending -> removed). Never let a
  // registry hiccup break the decision itself.
  try { await require('./beneficiaries').syncFromSubsidy(id); } catch (e) { console.error('beneficiary sync failed:', e.message); }
  // Notify the farmer of the decision.
  const label = { approved: 'approved', rejected: 'rejected', distributed: 'distributed', pending: 'reopened' }[status];
  await run(
    `INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, 'general', ?, ?, 'subsidies')`,
    [sub.farmer_id, 'Subsidy ' + label, `Your "${sub.title}" request was ${label}.`]
  );
  res.json({ subsidy: await get(`SELECT * FROM subsidies WHERE id = ?`, [id]) });
});

/** DELETE /api/subsidies/:id — farmer cancels own, or admin removes. */
router.delete('/:id', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  const sub = await get(`SELECT * FROM subsidies WHERE id = ?`, [id]);
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'super_admin' && sub.farmer_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await run(`DELETE FROM subsidies WHERE id = ?`, [id]);
  res.json({ ok: true });
});

module.exports = router;
