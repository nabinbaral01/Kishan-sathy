/**
 * Community Feed — a public wall where any logged-in user (mostly farmers) can
 * post text + a photo, and everyone can see, like and comment. The super admin
 * moderates: they can delete any post or comment.
 *
 *   GET    /api/feed                 list posts (newest first) + like/comment counts
 *   POST   /api/feed                 create a post { content, image }
 *   GET    /api/feed/:id             one post with its comments
 *   DELETE /api/feed/:id             delete a post (author or admin)
 *   POST   /api/feed/:id/like        toggle like -> { liked, like_count }
 *   POST   /api/feed/:id/comment     add a comment { content }
 *   DELETE /api/feed/comments/:id    delete a comment (author or admin)
 */
const express = require('express');
const { get, all, run, exec } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const MAX_IMAGES = 6;

/** A post's photos as an array (new `images` JSON, falling back to legacy `image`). */
function imagesOf(p) {
  if (p.images) {
    try { const a = JSON.parse(p.images); if (Array.isArray(a)) return a.filter(Boolean); } catch { /* fall through */ }
  }
  return p.image ? [p.image] : [];
}

// Production skips global schema init, so create our tables on first use.
let ready = null;
function ensureTables() {
  if (!ready) {
    ready = (async () => {
      await exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        content    TEXT,
        image      TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS post_likes (
        post_id    INTEGER NOT NULL,
        user_id    INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (post_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS post_comments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id    INTEGER NOT NULL,
        user_id    INTEGER NOT NULL,
        content    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
      // Multi-photo support was added after launch — migrate existing tables.
      const cols = await all(`PRAGMA table_info(posts)`);
      if (!cols.some((c) => c.name === 'images')) {
        await exec(`ALTER TABLE posts ADD COLUMN images TEXT`);
      }
    })();
  }
  return ready;
}

router.use(authRequired, async (_req, _res, next) => {
  try { await ensureTables(); next(); } catch (e) { next(e); }
});

/** Attach author info + like/comment counts + whether the current user liked it. */
async function decorate(rows, meId) {
  return Promise.all(rows.map(async (p) => {
    const u = await get(`SELECT name, avatar, ward, role FROM users WHERE id = ?`, [p.user_id]);
    const likes = (await get(`SELECT COUNT(*) c FROM post_likes WHERE post_id = ?`, [p.id])).c;
    const comments = (await get(`SELECT COUNT(*) c FROM post_comments WHERE post_id = ?`, [p.id])).c;
    const liked = !!(await get(`SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?`, [p.id, meId]));
    return {
      ...p,
      // Send photos as one clean array; drop the raw column forms so the same
      // base64 isn't shipped twice.
      image: undefined, images: imagesOf(p),
      author_name: u ? u.name : 'Unknown', author_avatar: u ? u.avatar : null,
      author_ward: u ? u.ward : null, author_role: u ? u.role : null,
      like_count: likes, comment_count: comments, liked,
    };
  }));
}

/** GET /api/feed */
router.get('/', async (req, res) => {
  const rows = await all(`SELECT * FROM posts ORDER BY created_at DESC LIMIT 200`);
  res.json({ posts: await decorate(rows, req.user.id) });
});

/** POST /api/feed  { content, images: [dataUrl], image (legacy single) } */
router.post('/', async (req, res) => {
  const content = (req.body?.content || '').trim();
  let images = Array.isArray(req.body?.images) ? req.body.images.filter((s) => typeof s === 'string' && s) : [];
  if (!images.length && req.body?.image) images = [req.body.image];
  images = images.slice(0, MAX_IMAGES);
  if (!content && !images.length) return res.status(400).json({ error: 'Write something or add a photo' });
  const info = await run(
    `INSERT INTO posts (user_id, content, image, images) VALUES (?,?,?,?)`,
    // `image` keeps the first photo so any older client still renders something.
    [req.user.id, content || null, images[0] || null, images.length ? JSON.stringify(images) : null]
  );
  const [post] = await decorate([await get(`SELECT * FROM posts WHERE id = ?`, [info.lastInsertRowid])], req.user.id);
  res.status(201).json({ post });
});

/** GET /api/feed/:id — one post with comments (author-decorated). */
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const row = await get(`SELECT * FROM posts WHERE id = ?`, [id]);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  const [post] = await decorate([row], req.user.id);
  const comments = await all(
    `SELECT c.*, u.name AS author_name, u.avatar AS author_avatar, u.role AS author_role
       FROM post_comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ? ORDER BY c.created_at ASC`,
    [id]
  );
  res.json({ post, comments });
});

/** DELETE /api/feed/:id — author or admin. */
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const post = await get(`SELECT * FROM posts WHERE id = ?`, [id]);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.user_id !== req.user.id && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
  await run(`DELETE FROM post_likes WHERE post_id = ?`, [id]);
  await run(`DELETE FROM post_comments WHERE post_id = ?`, [id]);
  await run(`DELETE FROM posts WHERE id = ?`, [id]);
  res.json({ ok: true });
});

/** POST /api/feed/:id/like — toggle. */
router.post('/:id/like', async (req, res) => {
  const id = Number(req.params.id);
  const post = await get(`SELECT id FROM posts WHERE id = ?`, [id]);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const existing = await get(`SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?`, [id, req.user.id]);
  if (existing) await run(`DELETE FROM post_likes WHERE post_id = ? AND user_id = ?`, [id, req.user.id]);
  else await run(`INSERT INTO post_likes (post_id, user_id) VALUES (?,?)`, [id, req.user.id]);
  const like_count = (await get(`SELECT COUNT(*) c FROM post_likes WHERE post_id = ?`, [id])).c;
  res.json({ liked: !existing, like_count });
});

/** POST /api/feed/:id/comment  { content } */
router.post('/:id/comment', async (req, res) => {
  const id = Number(req.params.id);
  const post = await get(`SELECT * FROM posts WHERE id = ?`, [id]);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const content = (req.body?.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Write a comment' });
  const info = await run(`INSERT INTO post_comments (post_id, user_id, content) VALUES (?,?,?)`, [id, req.user.id, content]);

  // Notify the post owner (unless they commented on their own post).
  if (post.user_id !== req.user.id) {
    await run(
      `INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, 'general', ?, ?, 'feed')`,
      [post.user_id, 'New comment', `${req.user.name} commented on your post.`]
    );
  }
  res.status(201).json({ comment: await get(`SELECT * FROM post_comments WHERE id = ?`, [info.lastInsertRowid]) });
});

/** DELETE /api/feed/comments/:id — author or admin. */
router.delete('/comments/:id', async (req, res) => {
  const id = Number(req.params.id);
  const c = await get(`SELECT * FROM post_comments WHERE id = ?`, [id]);
  if (!c) return res.status(404).json({ error: 'Comment not found' });
  if (c.user_id !== req.user.id && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
  await run(`DELETE FROM post_comments WHERE id = ?`, [id]);
  res.json({ ok: true });
});

module.exports = router;
