/**
 * Crop tracking (tree / plant / vegetable / animal categories).
 */
const express = require('express');
const { get, all, run } = require('../db');
const { authRequired } = require('../middleware/auth');
const { canAccessFarm } = require('../helpers');

const router = express.Router();

const CATEGORIES = ['tree', 'plant', 'vegetable', 'animal'];

/** GET /api/crops?category=&farmId=  -> own crops (farmer) / all (admin) */
router.get('/', authRequired, async (req, res) => {
  const { category, farmId } = req.query;
  const where = [], params = [];
  if (req.user.role !== 'super_admin') { where.push('farmer_id = ?'); params.push(req.user.id); }
  if (category) { where.push('category = ?'); params.push(category); }
  if (farmId) { where.push('farm_id = ?'); params.push(farmId); }
  const sql = `SELECT * FROM crops ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
  res.json({ crops: await all(sql, params) });
});

/** GET /api/crops/:id  -> crop detail with update history */
router.get('/:id', authRequired, async (req, res) => {
  const crop = await get(`SELECT * FROM crops WHERE crop_id = ?`, [Number(req.params.id)]);
  if (!crop) return res.status(404).json({ error: 'Crop not found' });
  if (req.user.role !== 'super_admin' && crop.farmer_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  crop.history = await all(`SELECT * FROM updates WHERE crop_id = ? ORDER BY created_at DESC`, [crop.crop_id]);
  res.json({ crop });
});

/** POST /api/crops  { farm_id, name, category, ... } */
router.post('/', authRequired, async (req, res) => {
  const b = req.body || {};
  if (!b.farm_id || !b.name || !b.category) {
    return res.status(400).json({ error: 'farm_id, name and category are required' });
  }
  if (!CATEGORIES.includes(b.category)) {
    return res.status(400).json({ error: `category must be one of ${CATEGORIES.join(', ')}` });
  }
  const farm = await get(`SELECT * FROM farms WHERE farm_id = ?`, [b.farm_id]);
  if (!canAccessFarm(req.user, farm)) {
    return res.status(farm ? 403 : 404).json({ error: farm ? 'Forbidden' : 'Farm not found' });
  }

  const info = await run(
    `INSERT INTO crops
      (farm_id, farmer_id, name, category, planted_date, plant_count, growth_stage,
       watering_schedule, fertilizer_used, disease_history, growth_status, harvest_date, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      farm.farm_id, farm.farmer_id, b.name, b.category,
      b.planted_date || null, b.plant_count ?? 0, b.growth_stage || 'Seedling',
      b.watering_schedule || null, b.fertilizer_used || null,
      b.disease_history || 'None', b.growth_status || 'Healthy',
      b.harvest_date || null, b.notes || null,
    ]
  );
  res.status(201).json({ crop: await get(`SELECT * FROM crops WHERE crop_id = ?`, [info.lastInsertRowid]) });
});

/** PATCH /api/crops/:id */
router.patch('/:id', authRequired, async (req, res) => {
  const crop = await get(`SELECT * FROM crops WHERE crop_id = ?`, [Number(req.params.id)]);
  if (!crop) return res.status(404).json({ error: 'Crop not found' });
  if (req.user.role !== 'super_admin' && crop.farmer_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const allowed = ['name', 'category', 'planted_date', 'plant_count', 'growth_stage',
    'watering_schedule', 'fertilizer_used', 'disease_history', 'growth_status', 'harvest_date', 'notes'];
  const fields = [], values = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) { fields.push(`${key} = ?`); values.push(req.body[key]); }
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(crop.crop_id);
  await run(`UPDATE crops SET ${fields.join(', ')} WHERE crop_id = ?`, values);
  res.json({ crop: await get(`SELECT * FROM crops WHERE crop_id = ?`, [crop.crop_id]) });
});

/** DELETE /api/crops/:id */
router.delete('/:id', authRequired, async (req, res) => {
  const crop = await get(`SELECT * FROM crops WHERE crop_id = ?`, [Number(req.params.id)]);
  if (!crop) return res.status(404).json({ error: 'Crop not found' });
  if (req.user.role !== 'super_admin' && crop.farmer_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await run(`DELETE FROM crops WHERE crop_id = ?`, [crop.crop_id]);
  res.json({ ok: true });
});

module.exports = router;
