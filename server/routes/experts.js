/**
 * Expert directory + profile management.
 */
const express = require('express');
const { get, all, run } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/experts
 *  - admin: every expert (incl. unverified) so they can approve them
 *  - others: only admin-verified, active experts (the public directory)
 */
router.get('/', authRequired, async (req, res) => {
  if (req.user.role === 'super_admin') {
    const experts = await all(`
      SELECT u.id, u.name, u.phone, u.email, u.active, u.created_at,
             e.specialization, e.bio, e.available, e.verified, e.proof_image
      FROM experts e JOIN users u ON u.id = e.expert_id
      ORDER BY e.verified ASC, u.created_at DESC
    `);
    return res.json({ experts });
  }
  const experts = await all(`
    SELECT u.id, u.name, u.phone, e.specialization, e.bio, e.available, e.verified
    FROM experts e JOIN users u ON u.id = e.expert_id
    WHERE u.active = 1 AND e.verified = 1
    ORDER BY e.available DESC, u.name ASC
  `);
  res.json({ experts });
});

/** PATCH /api/experts/:id/verify  { verified }  (admin only) */
router.patch('/:id/verify', authRequired, requireRole('super_admin'), async (req, res) => {
  const id = Number(req.params.id);
  const expert = await get(`SELECT * FROM experts WHERE expert_id = ?`, [id]);
  if (!expert) return res.status(404).json({ error: 'Expert not found' });
  const verified = req.body && req.body.verified ? 1 : 0;
  // Admin may only approve an expert who has submitted a proof document.
  if (verified && !expert.proof_image) {
    return res.status(400).json({ error: 'Cannot approve: expert has not submitted a proof document yet.' });
  }
  await run(`UPDATE experts SET verified = ? WHERE expert_id = ?`, [verified, id]);

  // Let the expert know.
  await run(
    `INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'general', ?, ?)`,
    [id, verified ? '✅ Verified by admin' : '⏳ Verification revoked',
      verified ? 'Your expert account is verified. You can now answer farmers.' : 'Your expert verification was revoked.']
  );

  res.json({ ok: true, expert_id: id, verified });
});

/** PATCH /api/experts/me -> expert updates own profile/availability/proof */
router.patch('/me', authRequired, requireRole('expert'), async (req, res) => {
  const { specialization, bio, available, proof_image } = req.body || {};
  const existing = await get(`SELECT * FROM experts WHERE expert_id = ?`, [req.user.id]);
  if (!existing) {
    await run(
      `INSERT INTO experts (expert_id, specialization, bio, available, proof_image) VALUES (?,?,?,?,?)`,
      [req.user.id, specialization || 'General Agriculture', bio || null, available ? 1 : 1, proof_image || null]
    );
  } else {
    const fields = [], values = [];
    if (specialization !== undefined) { fields.push('specialization = ?'); values.push(specialization); }
    if (bio !== undefined) { fields.push('bio = ?'); values.push(bio); }
    if (available !== undefined) { fields.push('available = ?'); values.push(available ? 1 : 0); }
    if (proof_image !== undefined) { fields.push('proof_image = ?'); values.push(proof_image || null); }
    if (fields.length) { values.push(req.user.id); await run(`UPDATE experts SET ${fields.join(', ')} WHERE expert_id = ?`, values); }
  }
  res.json({ expert: await get(`SELECT * FROM experts WHERE expert_id = ?`, [req.user.id]) });
});

module.exports = router;
