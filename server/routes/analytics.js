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

/** GET /api/analytics/wards (admin) -> per-ward rollup for Taplejung (wards 1–11) */
router.get('/wards', authRequired, requireRole('super_admin'), async (_req, res) => {
  const farmers = await all(`SELECT ward, COUNT(*) c FROM users WHERE role='farmer' AND ward IS NOT NULL GROUP BY ward`);
  const farms = await all(`SELECT u.ward AS ward, COUNT(*) c FROM farms f JOIN users u ON u.id = f.farmer_id WHERE u.ward IS NOT NULL GROUP BY u.ward`);
  const crops = await all(`SELECT u.ward AS ward, COUNT(*) c FROM crops cr JOIN users u ON u.id = cr.farmer_id WHERE u.ward IS NOT NULL GROUP BY u.ward`);
  const sales = await all(`SELECT u.ward AS ward, COALESCE(SUM(s.total_amount),0) t FROM sales s JOIN users u ON u.id = s.farmer_id WHERE u.ward IS NOT NULL GROUP BY u.ward`);
  const cats = await all(`SELECT u.ward AS ward, cr.category AS category, COUNT(*) c FROM crops cr JOIN users u ON u.id = cr.farmer_id WHERE u.ward IS NOT NULL GROUP BY u.ward, cr.category`);

  const byWard = {};
  for (let w = 1; w <= 11; w++) byWard[w] = { ward: w, farmers: 0, farms: 0, crops: 0, sales: 0, categories: {} };
  farmers.forEach((r) => { if (byWard[r.ward]) byWard[r.ward].farmers = r.c; });
  farms.forEach((r) => { if (byWard[r.ward]) byWard[r.ward].farms = r.c; });
  crops.forEach((r) => { if (byWard[r.ward]) byWard[r.ward].crops = r.c; });
  sales.forEach((r) => { if (byWard[r.ward]) byWard[r.ward].sales = Math.round(r.t); });
  cats.forEach((r) => { if (byWard[r.ward]) byWard[r.ward].categories[r.category] = r.c; });

  res.json({ wards: Object.values(byWard) });
});

/**
 * GET /api/analytics/outbreaks (admin)
 * Early-warning: wards where 2+ different farmers reported the SAME disease in the
 * last 30 days. Healthy ("No Disease") results are ignored.
 */
router.get('/outbreaks', authRequired, requireRole('super_admin'), async (_req, res) => {
  const outbreaks = await all(`
    SELECT u.ward AS ward,
           d.disease_name AS disease,
           COUNT(*) AS reports,
           COUNT(DISTINCT d.farmer_id) AS farmers,
           MAX(d.created_at) AS last_at
      FROM disease_detections d
      JOIN users u ON u.id = d.farmer_id
     WHERE u.ward IS NOT NULL
       AND d.disease_name IS NOT NULL
       AND d.disease_name NOT LIKE 'No Disease%'
       AND d.created_at >= datetime('now','-30 days')
     GROUP BY u.ward, d.disease_name
    HAVING COUNT(DISTINCT d.farmer_id) >= 2
     ORDER BY farmers DESC, reports DESC`);
  res.json({ outbreaks });
});

module.exports = router;
