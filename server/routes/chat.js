/**
 * Expert support chat — 1-to-1 conversations.
 * A conversation is keyed by the (farmer_id, expert_id) pair, so a farmer can
 * message individual experts privately and each expert only sees the farmers who
 * wrote to them.
 */
const express = require('express');
const { get, all, run } = require('../db');
const { authRequired } = require('../middleware/auth');
const gemini = require('../gemini');

const router = express.Router();

/**
 * POST /api/chat/ai  { messages: [{ role:'farmer'|'ai', text }] }
 * Instant AI farming assistant (Gemini). Stateless — the client sends the
 * recent history each time. Not stored in the expert-chat tables.
 */
router.post('/ai', authRequired, async (req, res) => {
  const history = Array.isArray(req.body?.messages) ? req.body.messages.slice(-12) : [];
  if (!history.length) return res.status(400).json({ error: 'messages is required' });
  if (!gemini.isEnabled()) {
    return res.json({ reply: "The AI assistant isn't set up yet. Meanwhile, you can ask a human expert from the Expert tab." });
  }
  try {
    const reply = await gemini.chat(history.map((m) => ({ role: m.role === 'farmer' ? 'farmer' : 'expert', text: m.text })));
    res.json({ reply: reply || 'Sorry, I could not generate a reply. Please try again.' });
  } catch (e) {
    console.warn('AI chat failed:', e.message);
    res.status(502).json({ error: 'The AI is busy right now — please try again in a moment.' });
  }
});

/**
 * GET /api/chat/threads
 *  - expert: farmers who have messaged THIS expert
 *  - farmer: experts the farmer has conversations with
 *  - admin : every (farmer, expert) conversation
 */
router.get('/threads', authRequired, async (req, res) => {
  if (req.user.role === 'expert') {
    const threads = await all(`
      SELECT m.farmer_id,
             u.name  AS farmer_name,
             u.phone AS farmer_phone,
             COUNT(*) AS message_count,
             MAX(m.created_at) AS last_at
      FROM messages m JOIN users u ON u.id = m.farmer_id
      WHERE m.expert_id = ?
      GROUP BY m.farmer_id
      ORDER BY last_at DESC
    `, [req.user.id]);
    return res.json({ threads });
  }

  if (req.user.role === 'farmer') {
    const threads = await all(`
      SELECT m.expert_id,
             u.name AS expert_name,
             e.specialization,
             COUNT(*) AS message_count,
             MAX(m.created_at) AS last_at
      FROM messages m
      JOIN users u   ON u.id = m.expert_id
      LEFT JOIN experts e ON e.expert_id = m.expert_id
      WHERE m.farmer_id = ? AND m.expert_id IS NOT NULL
      GROUP BY m.expert_id
      ORDER BY last_at DESC
    `, [req.user.id]);
    return res.json({ threads });
  }

  // admin: all conversations
  const threads = await all(`
    SELECT m.farmer_id, fu.name AS farmer_name,
           m.expert_id, eu.name AS expert_name,
           COUNT(*) AS message_count, MAX(m.created_at) AS last_at
    FROM messages m
    JOIN users fu ON fu.id = m.farmer_id
    LEFT JOIN users eu ON eu.id = m.expert_id
    GROUP BY m.farmer_id, m.expert_id
    ORDER BY last_at DESC
  `);
  res.json({ threads });
});

/**
 * GET /api/chat/messages
 *  - farmer: ?expertId=  -> conversation with that expert
 *  - expert: ?farmerId=  -> conversation with that farmer
 */
router.get('/messages', authRequired, async (req, res) => {
  let farmerId, expertId;
  if (req.user.role === 'farmer') {
    farmerId = req.user.id;
    expertId = Number(req.query.expertId);
    if (!expertId) return res.status(400).json({ error: 'expertId is required' });
  } else if (req.user.role === 'expert') {
    expertId = req.user.id;
    farmerId = Number(req.query.farmerId);
    if (!farmerId) return res.status(400).json({ error: 'farmerId is required' });
  } else {
    // admin can read any pair
    farmerId = Number(req.query.farmerId);
    expertId = Number(req.query.expertId);
    if (!farmerId || !expertId) return res.status(400).json({ error: 'farmerId and expertId are required' });
  }
  const messages = await all(
    `SELECT * FROM messages WHERE farmer_id = ? AND expert_id = ? ORDER BY created_at ASC`,
    [farmerId, expertId]
  );
  res.json({ messages });
});

/**
 * POST /api/chat/messages  { text?, image?, expertId?, farmerId? }
 *  - farmer: must pass expertId (a verified expert) -> opens/continues that thread
 *  - expert: must pass farmerId -> reply (expert must be admin-verified)
 */
router.post('/messages', authRequired, async (req, res) => {
  const { text, image, expertId, farmerId } = req.body || {};
  if (!text && !image) return res.status(400).json({ error: 'text or image is required' });

  let farmer_id, expert_id, sender_role;

  if (req.user.role === 'farmer') {
    farmer_id = req.user.id;
    expert_id = Number(expertId);
    if (!expert_id) return res.status(400).json({ error: 'expertId is required — choose an expert to message' });
    const e = await get(`SELECT verified FROM experts WHERE expert_id = ?`, [expert_id]);
    if (!e) return res.status(404).json({ error: 'Expert not found' });
    if (!e.verified) return res.status(403).json({ error: 'That expert is not verified yet' });
    sender_role = 'farmer';
  } else if (req.user.role === 'expert') {
    const e = await get(`SELECT verified FROM experts WHERE expert_id = ?`, [req.user.id]);
    if (!e || !e.verified) {
      return res.status(403).json({ error: 'Your expert account is awaiting admin verification.' });
    }
    expert_id = req.user.id;
    farmer_id = Number(farmerId);
    if (!farmer_id) return res.status(400).json({ error: 'farmerId is required for replies' });
    sender_role = 'expert';
  } else {
    return res.status(403).json({ error: 'Only farmers and experts can chat' });
  }

  const info = await run(
    `INSERT INTO messages (farmer_id, expert_id, sender_role, text, image) VALUES (?,?,?,?,?)`,
    [farmer_id, expert_id, sender_role, text || null, image || null]
  );

  // Notify the recipient (the other party in this 1-to-1 thread).
  const preview = (text || 'sent a photo').slice(0, 100);
  if (sender_role === 'farmer') {
    await run(
      `INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, 'general', ?, ?, 'threads')`,
      [expert_id, 'New question from a farmer', `${req.user.name}: ${preview}`]
    );
  } else {
    await run(
      `INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, 'general', ?, ?, 'chat')`,
      [farmer_id, 'Expert replied', preview]
    );
  }

  res.status(201).json({ message: await get(`SELECT * FROM messages WHERE id = ?`, [info.lastInsertRowid]) });
});

module.exports = router;
