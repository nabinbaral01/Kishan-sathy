/**
 * Nagarpalika (municipality) subsidy-beneficiary registry.
 * A government ledger the super admin maintains: who received which subsidy,
 * their name/age/ward/contact, amount, date and remarks. Supports manual entry,
 * a one-click import from farmers' approved/distributed subsidy applications,
 * and is exported to CSV (Excel) from the client.
 *
 *   GET    /api/beneficiaries            list (filter ?ward=&status=&q=) + totals
 *   POST   /api/beneficiaries            add a record
 *   PATCH  /api/beneficiaries/:id        edit a record
 *   DELETE /api/beneficiaries/:id        remove a record
 *   POST   /api/beneficiaries/import     pull in approved/distributed subsidies
 */
const express = require('express');
const { get, all, run, exec } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

const STATUSES = ['pending', 'approved', 'distributed'];
const FIELDS = ['name', 'age', 'ward', 'phone', 'address', 'subsidy_type', 'amount', 'given_date', 'status', 'remarks'];

// Production skips the global schema init (SKIP_DB_INIT), so make sure this
// table exists the first time the route is used. Memoized per process.
let ready = null;
function ensureTable() {
  if (!ready) {
    ready = exec(`
      CREATE TABLE IF NOT EXISTS beneficiaries (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        name              TEXT NOT NULL,
        age               INTEGER,
        ward              INTEGER,
        phone             TEXT,
        address           TEXT,
        subsidy_type      TEXT,
        amount            REAL,
        given_date        TEXT,
        status            TEXT NOT NULL DEFAULT 'approved',
        remarks           TEXT,
        source_subsidy_id INTEGER,
        created_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }
  return ready;
}

/** Coerce the incoming body into a clean, storable record. */
function cleanBody(b = {}) {
  const name = (b.name || '').trim();
  const age = b.age != null && b.age !== '' ? Number(b.age) : null;
  const ward = b.ward != null && b.ward !== '' ? Number(b.ward) : null;
  const amount = b.amount != null && b.amount !== '' ? Number(b.amount) : null;
  const status = STATUSES.includes(b.status) ? b.status : 'approved';
  return {
    name,
    age: Number.isFinite(age) ? age : null,
    ward: Number.isFinite(ward) ? ward : null,
    phone: (b.phone || '').trim() || null,
    address: (b.address || '').trim() || null,
    subsidy_type: (b.subsidy_type || '').trim() || null,
    amount: Number.isFinite(amount) ? amount : null,
    given_date: (b.given_date || '').trim() || null,
    status,
    remarks: (b.remarks || '').trim() || null,
  };
}

// Everything here is municipality-only.
router.use(authRequired, requireRole('super_admin'), async (_req, _res, next) => {
  try { await ensureTable(); next(); } catch (e) { next(e); }
});

/** GET /api/beneficiaries?ward=&status=&q= */
router.get('/', async (req, res) => {
  const { ward, status, q } = req.query;
  const where = [], params = [];
  if (ward) { where.push('ward = ?'); params.push(Number(ward)); }
  if (status && STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
  if (q) { where.push('(name LIKE ? OR phone LIKE ? OR address LIKE ? OR remarks LIKE ?)'); const like = `%${q}%`; params.push(like, like, like, like); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await all(`SELECT * FROM beneficiaries ${clause} ORDER BY created_at DESC`, params);
  const totalAmount = rows.reduce((s, r) => s + (r.amount || 0), 0);
  res.json({
    beneficiaries: rows,
    totals: { count: rows.length, amount: totalAmount },
  });
});

/** POST /api/beneficiaries */
router.post('/', async (req, res) => {
  const rec = cleanBody(req.body);
  if (!rec.name) return res.status(400).json({ error: 'Name is required' });
  const info = await run(
    `INSERT INTO beneficiaries (name, age, ward, phone, address, subsidy_type, amount, given_date, status, remarks)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [rec.name, rec.age, rec.ward, rec.phone, rec.address, rec.subsidy_type, rec.amount, rec.given_date, rec.status, rec.remarks]
  );
  res.status(201).json({ beneficiary: await get(`SELECT * FROM beneficiaries WHERE id = ?`, [info.lastInsertRowid]) });
});

/** PATCH /api/beneficiaries/:id */
router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await get(`SELECT * FROM beneficiaries WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ error: 'Record not found' });
  const rec = cleanBody({ ...existing, ...req.body });
  if (!rec.name) return res.status(400).json({ error: 'Name is required' });
  await run(
    `UPDATE beneficiaries SET name=?, age=?, ward=?, phone=?, address=?, subsidy_type=?, amount=?, given_date=?, status=?, remarks=? WHERE id=?`,
    [rec.name, rec.age, rec.ward, rec.phone, rec.address, rec.subsidy_type, rec.amount, rec.given_date, rec.status, rec.remarks, id]
  );
  res.json({ beneficiary: await get(`SELECT * FROM beneficiaries WHERE id = ?`, [id]) });
});

/** DELETE /api/beneficiaries/:id */
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await get(`SELECT * FROM beneficiaries WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ error: 'Record not found' });
  await run(`DELETE FROM beneficiaries WHERE id = ?`, [id]);
  res.json({ ok: true });
});

/** POST /api/beneficiaries/import — bring in approved/distributed subsidy applications. */
router.post('/import', async (_req, res) => {
  const subs = await all(
    `SELECT s.id FROM subsidies s WHERE s.status IN ('approved', 'distributed')`
  );
  let imported = 0, updated = 0;
  for (const s of subs) {
    const existed = await get(`SELECT id FROM beneficiaries WHERE source_subsidy_id = ?`, [s.id]);
    await syncFromSubsidy(s.id);
    if (existed) updated++; else imported++;
  }
  res.json({ imported, skipped: updated });
});

/**
 * Keep the registry in sync with a single subsidy application. Called by the
 * subsidies route whenever a decision changes: approved/distributed -> upsert a
 * beneficiary row (linked via source_subsidy_id); rejected/pending -> remove the
 * auto-added row so the ledger only lists people who actually got support.
 * Manual rows (no source_subsidy_id) are never touched.
 */
async function syncFromSubsidy(subsidyId) {
  await ensureTable();
  const s = await get(
    `SELECT s.id, s.type, s.title, s.amount, s.status, s.decided_at, s.created_at,
            u.name AS farmer_name, u.phone AS farmer_phone, u.address AS farmer_address, u.ward AS ward
       FROM subsidies s JOIN users u ON u.id = s.farmer_id WHERE s.id = ?`,
    [subsidyId]
  );
  if (!s) return;
  const existing = await get(`SELECT id FROM beneficiaries WHERE source_subsidy_id = ?`, [s.id]);
  if (s.status === 'approved' || s.status === 'distributed') {
    const date = (s.decided_at || s.created_at || '').slice(0, 10);
    if (existing) {
      await run(
        `UPDATE beneficiaries SET status=?, amount=?, subsidy_type=?, given_date=?, ward=? WHERE id=?`,
        [s.status, s.amount, s.type, date, s.ward, existing.id]
      );
    } else {
      await run(
        `INSERT INTO beneficiaries (name, age, ward, phone, address, subsidy_type, amount, given_date, status, remarks, source_subsidy_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [s.farmer_name, null, s.ward, s.farmer_phone, s.farmer_address, s.type, s.amount,
         date, s.status, s.title ? `Subsidy: ${s.title}` : null, s.id]
      );
    }
  } else if (existing) {
    await run(`DELETE FROM beneficiaries WHERE id = ?`, [existing.id]);
  }
}

module.exports = router;
module.exports.syncFromSubsidy = syncFromSubsidy;
