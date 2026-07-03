/**
 * Local marketplace ("Bazar") — residents buy & sell local products: vegetables,
 * fruit, grain, animals, dairy, handicrafts, seeds, tools, etc.
 *
 *  Listings:
 *   GET    /api/products            browse available listings (?category=&q=)
 *   GET    /api/products/mine       my own listings
 *   GET    /api/products/:id        one listing (with seller info)
 *   POST   /api/products            create a listing
 *   PATCH  /api/products/:id        edit / mark sold
 *   DELETE /api/products/:id        remove a listing
 *
 *  Orders:
 *   POST   /api/products/:id/order  place an order (buyer) -> notifies seller
 *   GET    /api/products/orders/all orders I placed + orders on my products
 *   PATCH  /api/products/orders/:id seller updates status (accept/reject/complete)
 */
const express = require('express');
const { get, all, run } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const CATEGORIES = ['vegetable', 'fruit', 'grain', 'animal', 'dairy', 'handicraft', 'seed', 'tool', 'other'];

/** Attach seller name/phone + sold count to a listing row. */
async function withSeller(p) {
  if (!p) return p;
  const s = await get(`SELECT name, phone, show_contact FROM users WHERE id = ?`, [p.seller_id]);
  const sold = (await get(`SELECT COUNT(*) AS c FROM orders WHERE product_id = ? AND status = 'completed'`, [p.id])).c;
  // A per-listing contact always shows; the personal phone only if the seller allows it.
  const fallbackPhone = s && s.show_contact ? s.phone : null;
  return { ...p, seller_name: s ? s.name : 'Unknown', seller_phone: p.contact || fallbackPhone, sold_count: sold };
}

/** Attach seller info to a list of products. */
function withSellerList(rows) {
  return Promise.all(rows.map(withSeller));
}

/** GET /api/products?category=&q=&sort=&minPrice=&maxPrice= -> available listings */
router.get('/', authRequired, async (req, res) => {
  const { category, q, sort, minPrice, maxPrice } = req.query;
  const where = [`status = 'available'`], params = [];
  if (category && CATEGORIES.includes(category)) { where.push('category = ?'); params.push(category); }
  if (q) { where.push('(title LIKE ? OR description LIKE ? OR location LIKE ?)'); const like = `%${q}%`; params.push(like, like, like); }
  if (minPrice !== undefined && minPrice !== '') { where.push('price >= ?'); params.push(Number(minPrice)); }
  if (maxPrice !== undefined && maxPrice !== '') { where.push('price <= ?'); params.push(Number(maxPrice)); }

  const ORDER = {
    price_asc: 'price ASC, created_at DESC',
    price_desc: 'price DESC, created_at DESC',
    new: 'created_at DESC',
  };
  const orderBy = ORDER[sort] || ORDER.new;

  const rows = await all(
    `SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`,
    params
  );
  res.json({ products: await withSellerList(rows), categories: CATEGORIES });
});

/** GET /api/products/mine -> my listings (any status) */
router.get('/mine', authRequired, async (req, res) => {
  const rows = await all(`SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC`, [req.user.id]);
  res.json({ products: await withSellerList(rows) });
});

/** GET /api/products/orders/all -> { placed, received } for the current user */
router.get('/orders/all', authRequired, async (req, res) => {
  const placed = await all(
    `SELECT o.*, p.title, p.image, p.unit FROM orders o JOIN products p ON p.id = o.product_id
      WHERE o.buyer_id = ? ORDER BY o.created_at DESC`,
    [req.user.id]
  );
  const received = await all(
    `SELECT o.*, p.title, p.image, p.unit, u.name AS buyer_name, u.phone AS buyer_phone
       FROM orders o JOIN products p ON p.id = o.product_id JOIN users u ON u.id = o.buyer_id
      WHERE o.seller_id = ? ORDER BY o.created_at DESC`,
    [req.user.id]
  );
  res.json({ placed, received });
});

/** GET /api/products/:id */
router.get('/:id', authRequired, async (req, res) => {
  const p = await get(`SELECT * FROM products WHERE id = ?`, [Number(req.params.id)]);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json({ product: await withSeller(p) });
});

/** POST /api/products */
router.post('/', authRequired, async (req, res) => {
  const b = req.body || {};
  const title = (b.title || '').trim();
  const category = CATEGORIES.includes(b.category) ? b.category : 'other';
  const price = Number(b.price);
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!(price >= 0)) return res.status(400).json({ error: 'price must be 0 or more' });

  const info = await run(
    `INSERT INTO products (seller_id, title, category, description, price, unit, quantity, location, image, contact)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      req.user.id, title, category, b.description || null, price,
      b.unit || 'piece', b.quantity != null ? Number(b.quantity) : 1,
      b.location || null, b.image || null, b.contact || null,
    ]
  );
  res.status(201).json({ product: await withSeller(await get(`SELECT * FROM products WHERE id = ?`, [info.lastInsertRowid])) });
});

/** PATCH /api/products/:id  (owner only) */
router.patch('/:id', authRequired, async (req, res) => {
  const p = await get(`SELECT * FROM products WHERE id = ?`, [Number(req.params.id)]);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  if (p.seller_id !== req.user.id && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });

  const allowed = ['title', 'category', 'description', 'price', 'unit', 'quantity', 'location', 'image', 'contact', 'status'];
  const fields = [], values = [];
  for (const k of allowed) if (req.body[k] !== undefined) { fields.push(`${k} = ?`); values.push(req.body[k]); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(p.id);
  await run(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, values);
  res.json({ product: await withSeller(await get(`SELECT * FROM products WHERE id = ?`, [p.id])) });
});

/** DELETE /api/products/:id  (owner/admin) */
router.delete('/:id', authRequired, async (req, res) => {
  const p = await get(`SELECT * FROM products WHERE id = ?`, [Number(req.params.id)]);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  if (p.seller_id !== req.user.id && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
  await run(`DELETE FROM products WHERE id = ?`, [p.id]);
  res.json({ ok: true });
});

/** POST /api/products/:id/order  { quantity, message } */
router.post('/:id/order', authRequired, async (req, res) => {
  const p = await get(`SELECT * FROM products WHERE id = ?`, [Number(req.params.id)]);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  if (p.status !== 'available') return res.status(400).json({ error: 'This product is no longer available' });
  if (p.seller_id === req.user.id) return res.status(400).json({ error: 'You cannot order your own product' });

  const quantity = Number(req.body?.quantity) || 1;
  if (!(quantity > 0)) return res.status(400).json({ error: 'quantity must be greater than 0' });
  const total = quantity * p.price;

  const info = await run(
    `INSERT INTO orders (product_id, buyer_id, seller_id, quantity, total, message) VALUES (?,?,?,?,?,?)`,
    [p.id, req.user.id, p.seller_id, quantity, total, req.body?.message || null]
  );

  // Notify the seller of the new order.
  await run(
    `INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, 'general', ?, ?, 'myShop')`,
    [p.seller_id, 'New order in Bazar', `${req.user.name} ordered ${quantity} ${p.unit} of "${p.title}" (Rs ${Math.round(total)})`]
  );

  res.status(201).json({ order: await get(`SELECT * FROM orders WHERE id = ?`, [info.lastInsertRowid]) });
});

/** PATCH /api/products/orders/:id  (seller) { status } */
router.patch('/orders/:id', authRequired, async (req, res) => {
  const o = await get(`SELECT * FROM orders WHERE id = ?`, [Number(req.params.id)]);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  if (o.seller_id !== req.user.id && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only the seller can update this order' });
  const status = req.body?.status;
  if (!['accepted', 'rejected', 'completed', 'pending'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  await run(`UPDATE orders SET status = ? WHERE id = ?`, [status, o.id]);
  const prod = await get(`SELECT * FROM products WHERE id = ?`, [o.product_id]);

  // On completion (first time only): mark the product sold AND record it in the
  // seller's Sales list so Bazar sales feed the sales chart/total automatically.
  if (status === 'completed' && o.status !== 'completed') {
    await run(`UPDATE products SET status = 'sold' WHERE id = ?`, [o.product_id]);
    const buyer = await get(`SELECT name FROM users WHERE id = ?`, [o.buyer_id]);
    await run(
      `INSERT INTO sales (farmer_id, product, category, quantity, unit, price_per_unit, total_amount, buyer, sale_date, notes)
       VALUES (?,?,?,?,?,?,?,?,date('now'),?)`,
      [
        o.seller_id, prod ? prod.title : 'Bazar product', prod ? prod.category : null,
        o.quantity, prod ? prod.unit : null, prod ? prod.price : 0, o.total,
        buyer ? buyer.name : null, 'Sold via Bazar',
      ]
    );
  }

  // Notify the buyer.
  const labels = { accepted: 'accepted', rejected: 'declined', completed: 'completed', pending: 'reopened' };
  await run(
    `INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, 'general', ?, ?, 'myPurchases')`,
    [o.buyer_id, 'Order update', `Your order for "${prod ? prod.title : 'a product'}" was ${labels[status]}.`]
  );

  res.json({ order: await get(`SELECT * FROM orders WHERE id = ?`, [o.id]) });
});

module.exports = router;
