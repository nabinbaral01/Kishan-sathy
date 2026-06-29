/**
 * Market prices. Public read for any logged-in user; admin manages entries.
 * Includes a naive demand/selling suggestion derived from the trend field.
 */
const express = require('express');
const { get, all, run } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

function suggestion(trend) {
  if (trend === 'up') return 'Prices rising — good time to sell.';
  if (trend === 'down') return 'Prices falling — consider holding or storing.';
  return 'Prices stable — sell as per your need.';
}

/** GET /api/market?category=&crop= */
router.get('/', authRequired, async (req, res) => {
  const { category, crop } = req.query;
  const where = [], params = [];
  if (category) { where.push('category = ?'); params.push(category); }
  if (crop) { where.push('crop_name LIKE ?'); params.push(`%${crop}%`); }
  const sql = `SELECT * FROM market_prices ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY date DESC, crop_name ASC`;
  const prices = (await all(sql, params)).map((p) => ({ ...p, suggestion: suggestion(p.trend) }));
  res.json({ prices });
});

/** POST /api/market  (admin) */
router.post('/', authRequired, requireRole('super_admin'), async (req, res) => {
  const { crop_name, category, market_name, price, unit, trend, date } = req.body || {};
  if (!crop_name || price == null) return res.status(400).json({ error: 'crop_name and price are required' });
  const info = await run(
    `INSERT INTO market_prices (crop_name, category, market_name, price, unit, trend, date)
     VALUES (?,?,?,?,?,?,COALESCE(?, date('now')))`,
    [crop_name, category || null, market_name || null, price, unit || 'per kg', trend || 'stable', date || null]
  );
  res.status(201).json({ price: await get(`SELECT * FROM market_prices WHERE id = ?`, [info.lastInsertRowid]) });
});

/** PATCH /api/market/:id (admin) */
router.patch('/:id', authRequired, requireRole('super_admin'), async (req, res) => {
  const allowed = ['crop_name', 'category', 'market_name', 'price', 'unit', 'trend', 'date'];
  const fields = [], values = [];
  for (const k of allowed) if (req.body[k] !== undefined) { fields.push(`${k} = ?`); values.push(req.body[k]); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(Number(req.params.id));
  await run(`UPDATE market_prices SET ${fields.join(', ')} WHERE id = ?`, values);
  res.json({ price: await get(`SELECT * FROM market_prices WHERE id = ?`, [Number(req.params.id)]) });
});

/** DELETE /api/market/:id (admin) */
router.delete('/:id', authRequired, requireRole('super_admin'), async (req, res) => {
  await run(`DELETE FROM market_prices WHERE id = ?`, [Number(req.params.id)]);
  res.json({ ok: true });
});

module.exports = router;
