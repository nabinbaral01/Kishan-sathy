/**
 * Crop updates: the "UPDATE" flow after scanning a QR.
 * A single update records changed details + photos and also patches the crop row
 * so the latest values stay queryable, while preserving full history in `updates`.
 */
const express = require('express');
const { get, all, transaction } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

/** GET /api/updates?cropId= */
router.get('/', authRequired, async (req, res) => {
  const { cropId } = req.query;
  if (cropId) {
    const crop = await get(`SELECT * FROM crops WHERE crop_id = ?`, [Number(cropId)]);
    if (!crop) return res.status(404).json({ error: 'Crop not found' });
    if (req.user.role !== 'super_admin' && crop.farmer_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return res.json({ updates: await all(`SELECT * FROM updates WHERE crop_id = ? ORDER BY created_at DESC`, [crop.crop_id]) });
  }
  const rows = req.user.role === 'super_admin'
    ? await all(`SELECT * FROM updates ORDER BY created_at DESC LIMIT 200`)
    : await all(`SELECT * FROM updates WHERE farmer_id = ? ORDER BY created_at DESC LIMIT 200`, [req.user.id]);
  res.json({ updates: rows });
});

/**
 * POST /api/updates  { crop_id, details:{...}, images:[...] }
 * details may include any of: name, plant_count, growth_stage, fertilizer_used,
 * watering_schedule, disease_history, growth_status, harvest_date, notes.
 */
router.post('/', authRequired, async (req, res) => {
  const { crop_id, details, images } = req.body || {};
  if (!crop_id) return res.status(400).json({ error: 'crop_id is required' });

  const crop = await get(`SELECT * FROM crops WHERE crop_id = ?`, [Number(crop_id)]);
  if (!crop) return res.status(404).json({ error: 'Crop not found' });
  if (req.user.role !== 'super_admin' && crop.farmer_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const detailObj = details && typeof details === 'object' ? details : {};
  const imageArr = Array.isArray(images) ? images : [];

  const id = await transaction(async (tx) => {
    const info = await tx.run(
      `INSERT INTO updates (crop_id, farmer_id, details, images) VALUES (?, ?, ?, ?)`,
      [crop.crop_id, crop.farmer_id, JSON.stringify(detailObj), JSON.stringify(imageArr)]
    );

    // Sync latest values onto the crop row.
    const syncable = ['name', 'plant_count', 'growth_stage', 'fertilizer_used',
      'watering_schedule', 'disease_history', 'growth_status', 'harvest_date', 'notes'];
    const fields = [], values = [];
    for (const key of syncable) {
      if (detailObj[key] !== undefined) { fields.push(`${key} = ?`); values.push(detailObj[key]); }
    }
    if (fields.length) {
      values.push(crop.crop_id);
      await tx.run(`UPDATE crops SET ${fields.join(', ')} WHERE crop_id = ?`, values);
    }
    return info.lastInsertRowid;
  });

  res.status(201).json({
    update: await get(`SELECT * FROM updates WHERE update_id = ?`, [id]),
    crop: await get(`SELECT * FROM crops WHERE crop_id = ?`, [crop.crop_id]),
  });
});

module.exports = router;
