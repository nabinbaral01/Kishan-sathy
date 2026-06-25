/**
 * Field / Farm management.
 * Farmers see and manage only their own farms; super admin sees all.
 */
const express = require('express');
const { get, all, run } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { nextFarmId, canAccessFarm } = require('../helpers');

const router = express.Router();

/** GET /api/farms  -> own farms (farmer) or all (admin); ?farmerId= to filter as admin */
router.get('/', authRequired, async (req, res) => {
  let rows;
  if (req.user.role === 'super_admin') {
    rows = req.query.farmerId
      ? await all(`SELECT * FROM farms WHERE farmer_id = ? ORDER BY created_at DESC`, [Number(req.query.farmerId)])
      : await all(`SELECT * FROM farms ORDER BY created_at DESC`);
  } else {
    rows = await all(`SELECT * FROM farms WHERE farmer_id = ? ORDER BY created_at DESC`, [req.user.id]);
  }
  // attach crop counts
  for (const f of rows) {
    const c = await get(`SELECT COUNT(*) c FROM crops WHERE farm_id = ?`, [f.farm_id]);
    f.crop_count = c.c;
  }
  res.json({ farms: rows });
});

/** GET /api/farms/:farmId  -> full field info incl. crops */
router.get('/:farmId', authRequired, async (req, res) => {
  const farm = await get(`SELECT * FROM farms WHERE farm_id = ?`, [req.params.farmId]);
  if (!canAccessFarm(req.user, farm)) {
    return res.status(farm ? 403 : 404).json({ error: farm ? 'Forbidden' : 'Farm not found' });
  }
  farm.owner = await get(`SELECT id, name, phone FROM users WHERE id = ?`, [farm.farmer_id]);
  farm.crops = await all(`SELECT * FROM crops WHERE farm_id = ? ORDER BY created_at DESC`, [farm.farm_id]);
  res.json({ farm });
});

/** POST /api/farms  (farmer or admin). Auto-assigns KISAN-### id. */
router.post('/', authRequired, requireRole('farmer', 'super_admin'), async (req, res) => {
  const { name, location, latitude, longitude, size, size_unit, soil_type, farmer_id } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Farm name is required' });

  // admin may create on behalf of a farmer; otherwise it's the caller's own farm.
  const ownerId = req.user.role === 'super_admin' && farmer_id ? Number(farmer_id) : req.user.id;
  const farmId = await nextFarmId();

  await run(
    `INSERT INTO farms (farm_id, farmer_id, name, location, latitude, longitude, size, size_unit, soil_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      farmId, ownerId, name, location || null,
      latitude ?? null, longitude ?? null,
      size ?? null, size_unit || 'ropani', soil_type || null,
    ]
  );

  const farm = await get(`SELECT * FROM farms WHERE farm_id = ?`, [farmId]);
  res.status(201).json({ farm });
});

/** PATCH /api/farms/:farmId */
router.patch('/:farmId', authRequired, async (req, res) => {
  const farm = await get(`SELECT * FROM farms WHERE farm_id = ?`, [req.params.farmId]);
  if (!canAccessFarm(req.user, farm)) {
    return res.status(farm ? 403 : 404).json({ error: farm ? 'Forbidden' : 'Farm not found' });
  }
  const allowed = ['name', 'location', 'latitude', 'longitude', 'size', 'size_unit', 'soil_type'];
  const fields = [], values = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) { fields.push(`${key} = ?`); values.push(req.body[key]); }
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(farm.farm_id);
  await run(`UPDATE farms SET ${fields.join(', ')} WHERE farm_id = ?`, values);
  res.json({ farm: await get(`SELECT * FROM farms WHERE farm_id = ?`, [farm.farm_id]) });
});

/** DELETE /api/farms/:farmId */
router.delete('/:farmId', authRequired, async (req, res) => {
  const farm = await get(`SELECT * FROM farms WHERE farm_id = ?`, [req.params.farmId]);
  if (!canAccessFarm(req.user, farm)) {
    return res.status(farm ? 403 : 404).json({ error: farm ? 'Forbidden' : 'Farm not found' });
  }
  await run(`DELETE FROM farms WHERE farm_id = ?`, [farm.farm_id]);
  res.json({ ok: true });
});

module.exports = router;
