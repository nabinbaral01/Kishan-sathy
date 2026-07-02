/**
 * Sales tracking — record how much a farmer sells and chart it per month.
 *  - GET  /api/sales            list the farmer's sales (admin: all)
 *  - GET  /api/sales/summary    monthly totals + headline stats for the chart
 *  - POST /api/sales            record a sale
 *  - DELETE /api/sales/:id       remove a sale
 */
const express = require('express');
const { get, all, run } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

/** Scope rows to the current farmer; super_admin sees everyone's. */
function scope(req) {
  return req.user.role === 'super_admin'
    ? { clause: '', params: [] }
    : { clause: 'WHERE farmer_id = ?', params: [req.user.id] };
}

/** GET /api/sales */
router.get('/', authRequired, async (req, res) => {
  const { clause, params } = scope(req);
  const sales = await all(
    `SELECT * FROM sales ${clause} ORDER BY sale_date DESC, id DESC`,
    params
  );
  res.json({ sales });
});

/**
 * GET /api/sales/summary?months=12
 * Returns one bucket per calendar month (oldest -> newest) so the client can
 * draw a bar chart, plus headline totals.
 */
router.get('/summary', authRequired, async (req, res) => {
  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);
  const { clause, params } = scope(req);

  // Aggregate amount + quantity per YYYY-MM.
  const rows = await all(
    `SELECT strftime('%Y-%m', sale_date) AS month,
            SUM(total_amount) AS amount,
            SUM(quantity)     AS quantity,
            COUNT(*)          AS count
       FROM sales ${clause}
      GROUP BY month`,
    params
  );
  const byMonth = Object.fromEntries(rows.map((r) => [r.month, r]));

  // Build a continuous series for the last `months` months (incl. empty ones).
  const series = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const r = byMonth[key];
    series.push({
      month: key,
      label: d.toLocaleString('en', { month: 'short' }),
      amount: r ? Math.round(r.amount) : 0,
      quantity: r ? Math.round(r.quantity) : 0,
      count: r ? r.count : 0,
    });
  }

  const totalAmount = (await get(`SELECT SUM(total_amount) AS t FROM sales ${clause}`, params)).t || 0;
  const totalCount = (await get(`SELECT COUNT(*) AS c FROM sales ${clause}`, params)).c || 0;
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  res.json({
    series,
    stats: {
      total_amount: Math.round(totalAmount),
      total_sales: totalCount,
      this_month: series.find((s) => s.month === thisMonthKey)?.amount || 0,
      best_month: series.reduce((b, s) => (s.amount > (b?.amount || 0) ? s : b), null),
    },
  });
});

/** POST /api/sales  { product, quantity, price_per_unit, ... } */
router.post('/', authRequired, async (req, res) => {
  const b = req.body || {};
  const product = (b.product || '').trim();
  const quantity = Number(b.quantity);
  const price = Number(b.price_per_unit);
  if (!product) return res.status(400).json({ error: 'product is required' });
  if (!(quantity > 0)) return res.status(400).json({ error: 'quantity must be greater than 0' });
  if (!(price >= 0)) return res.status(400).json({ error: 'price_per_unit must be 0 or more' });

  const total = b.total_amount != null ? Number(b.total_amount) : quantity * price;

  const info = await run(
    `INSERT INTO sales
       (farmer_id, crop_id, product, category, quantity, unit, price_per_unit, total_amount, buyer, sale_date, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      req.user.id, b.crop_id || null, product, b.category || null,
      quantity, b.unit || 'kg', price, total, b.buyer || null,
      b.sale_date || new Date().toISOString().slice(0, 10), b.notes || null,
    ]
  );
  res.status(201).json({ sale: await get(`SELECT * FROM sales WHERE id = ?`, [info.lastInsertRowid]) });
});

/** DELETE /api/sales/:id */
router.delete('/:id', authRequired, async (req, res) => {
  const sale = await get(`SELECT * FROM sales WHERE id = ?`, [Number(req.params.id)]);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  if (req.user.role !== 'super_admin' && sale.farmer_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await run(`DELETE FROM sales WHERE id = ?`, [sale.id]);
  res.json({ ok: true });
});

module.exports = router;
