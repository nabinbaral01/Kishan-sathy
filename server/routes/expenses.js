/**
 * Expense tracking — workers' wages, fertilizer, seed, plants, etc.
 *  - GET  /api/expenses            list the farmer's expenses (admin: all)
 *  - GET  /api/expenses/summary    monthly expenses + income (from sales),
 *                                  category breakdown and profit stats
 *  - POST /api/expenses            record an expense
 *  - DELETE /api/expenses/:id       remove an expense
 */
const express = require('express');
const { get, all, run } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const CATEGORIES = ['wages', 'fertilizer', 'seed', 'plants', 'pesticide', 'equipment', 'transport', 'other'];

function scope(req) {
  return req.user.role === 'super_admin'
    ? { clause: '', params: [] }
    : { clause: 'WHERE farmer_id = ?', params: [req.user.id] };
}

/** GET /api/expenses */
router.get('/', authRequired, async (req, res) => {
  const { clause, params } = scope(req);
  const expenses = await all(
    `SELECT * FROM expenses ${clause} ORDER BY expense_date DESC, id DESC`,
    params
  );
  res.json({ expenses, categories: CATEGORIES });
});

/** GET /api/expenses/summary?months=6 */
router.get('/summary', authRequired, async (req, res) => {
  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);
  const { clause, params } = scope(req);

  const expRows = await all(
    `SELECT strftime('%Y-%m', expense_date) AS month, SUM(amount) AS total
       FROM expenses ${clause} GROUP BY month`,
    params
  );
  const incRows = await all(
    `SELECT strftime('%Y-%m', sale_date) AS month, SUM(total_amount) AS total
       FROM sales ${clause} GROUP BY month`,
    params
  );
  const expByMonth = Object.fromEntries(expRows.map((r) => [r.month, r.total]));
  const incByMonth = Object.fromEntries(incRows.map((r) => [r.month, r.total]));

  const series = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const expenses = Math.round(expByMonth[key] || 0);
    const income = Math.round(incByMonth[key] || 0);
    series.push({
      month: key,
      label: d.toLocaleString('en', { month: 'short' }),
      expenses, income, profit: income - expenses,
    });
  }

  // Category breakdown across all expenses.
  const categories = (await all(
    `SELECT category, SUM(amount) AS amount, COUNT(*) AS count
       FROM expenses ${clause} GROUP BY category ORDER BY amount DESC`,
    params
  )).map((r) => ({ ...r, amount: Math.round(r.amount) }));

  const totalExpenses = Math.round((await get(`SELECT SUM(amount) AS t FROM expenses ${clause}`, params)).t || 0);
  const totalIncome = Math.round((await get(`SELECT SUM(total_amount) AS t FROM sales ${clause}`, params)).t || 0);
  const thisKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = series.find((s) => s.month === thisKey) || { expenses: 0, income: 0, profit: 0 };

  res.json({
    series,
    categories,
    stats: {
      total_expenses: totalExpenses,
      total_income: totalIncome,
      total_profit: totalIncome - totalExpenses,
      this_month_expenses: thisMonth.expenses,
      this_month_profit: thisMonth.profit,
      top_category: categories[0] || null,
    },
  });
});

/** POST /api/expenses */
router.post('/', authRequired, async (req, res) => {
  const b = req.body || {};
  const category = CATEGORIES.includes(b.category) ? b.category : 'other';
  const description = (b.description || '').trim();
  if (!description) return res.status(400).json({ error: 'description is required' });

  const workers = b.workers != null && b.workers !== '' ? Number(b.workers) : null;
  const quantity = b.quantity != null && b.quantity !== '' ? Number(b.quantity) : null;
  const rate = Number(b.rate) || 0;

  // Total = workers×rate (wages) or quantity×rate (materials) or an explicit amount.
  let amount;
  if (b.amount != null && b.amount !== '') amount = Number(b.amount);
  else if (workers != null) amount = workers * rate;
  else if (quantity != null) amount = quantity * rate;
  else amount = rate;
  if (!(amount >= 0)) return res.status(400).json({ error: 'amount must be 0 or more' });

  const info = await run(
    `INSERT INTO expenses
       (farmer_id, crop_id, category, description, workers, quantity, unit, rate, amount, expense_date, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      req.user.id, b.crop_id || null, category, description,
      workers, quantity, b.unit || null, rate, amount,
      b.expense_date || new Date().toISOString().slice(0, 10), b.notes || null,
    ]
  );
  res.status(201).json({ expense: await get(`SELECT * FROM expenses WHERE id = ?`, [info.lastInsertRowid]) });
});

/** DELETE /api/expenses/:id */
router.delete('/:id', authRequired, async (req, res) => {
  const exp = await get(`SELECT * FROM expenses WHERE id = ?`, [Number(req.params.id)]);
  if (!exp) return res.status(404).json({ error: 'Expense not found' });
  if (req.user.role !== 'super_admin' && exp.farmer_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await run(`DELETE FROM expenses WHERE id = ?`, [exp.id]);
  res.json({ ok: true });
});

module.exports = router;
