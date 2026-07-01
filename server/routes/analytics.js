/**
 * Super-admin analytics dashboard summary.
 */
const express = require('express');
const { get, all } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

/** GET /api/analytics/summary (admin) */
router.get('/summary', authRequired, requireRole('super_admin'), async (_req, res) => {
  const count = async (sql, params = []) => (await get(sql, params)).c;

  res.json({
    totals: {
      farmers: await count(`SELECT COUNT(*) c FROM users WHERE role = 'farmer'`),
      experts: await count(`SELECT COUNT(*) c FROM users WHERE role = 'expert'`),
      farms: await count(`SELECT COUNT(*) c FROM farms`),
      crops: await count(`SELECT COUNT(*) c FROM crops`),
      qr_codes: await count(`SELECT COUNT(*) c FROM qr_codes`),
      disease_reports: await count(`SELECT COUNT(*) c FROM disease_detections`),
      open_chats: await count(`SELECT COUNT(DISTINCT farmer_id) c FROM messages`),
    },
    crops_by_category: await all(
      `SELECT category, COUNT(*) AS count FROM crops GROUP BY category`
    ),
    crop_health: await all(
      `SELECT growth_status, COUNT(*) AS count FROM crops GROUP BY growth_status`
    ),
    recent_diseases: await all(
      `SELECT disease_name, COUNT(*) AS count FROM disease_detections
       GROUP BY disease_name ORDER BY count DESC LIMIT 5`
    ),
  });
});

module.exports = router;
