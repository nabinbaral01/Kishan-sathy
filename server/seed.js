/**
 * Seed demo data: super admin, expert, two farmers, farms (incl. the spec's
 * KISAN-001 tomato field), crops, QR codes, market prices, weather, notifications
 * and a sample expert chat. Idempotent-ish: clears core tables first.
 *
 * Run against your Turso database:  TURSO_DATABASE_URL / TURSO_AUTH_TOKEN must be
 * set (in .env or the environment), then `npm run seed`.
 */
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const { run, ensureReady } = require('./db');

const BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:4000';

async function seed() {
  console.log('🌱 Seeding Kisan Sathi demo data...');

  // Make sure the schema exists first.
  await ensureReady();

  // Wipe in FK-safe order.
  for (const t of ['orders', 'products', 'disease_detections', 'messages', 'notifications', 'updates',
    'expenses', 'sales', 'qr_codes', 'crops', 'farms', 'experts', 'market_prices', 'weather', 'users']) {
    await run(`DELETE FROM ${t}`);
  }

  const pass = (p) => bcrypt.hashSync(p, 10);
  const insUser = (name, role, phone, email, pw, lang, ward = null) =>
    run(`INSERT INTO users (name, role, phone, email, password_hash, language, ward) VALUES (?,?,?,?,?,?,?)`,
      [name, role, phone, email, pass(pw), lang, ward]);

  const adminId = (await insUser('Super Admin', 'super_admin', '9800000000', 'admin@kisansathi.app', 'admin123', 'en')).lastInsertRowid;
  const expertId = (await insUser('Dr. Sita Sharma', 'expert', '9811111111', 'expert@kisansathi.app', 'expert123', 'en')).lastInsertRowid;
  await run(`INSERT INTO experts (expert_id, specialization, bio, verified) VALUES (?,?,?,1)`,
    [expertId, 'Crop Diseases & Soil Health', 'PhD in Plant Pathology, 12 years field experience.']);

  // Farmers belong to a ward (1–11) of Taplejung Nagarpalika.
  const ramId = (await insUser('Ram Bahadur', 'farmer', '9822222222', 'ram@example.com', 'farmer123', 'ne', 3)).lastInsertRowid;
  const gitaId = (await insUser('Gita Thapa', 'farmer', '9833333333', 'gita@example.com', 'farmer123', 'ne', 7)).lastInsertRowid;
  // A second Ward-3 farmer — used to demo the disease-outbreak early-warning.
  const bhimId = (await insUser('Bhim Rai', 'farmer', '9844444444', 'bhim@example.com', 'farmer123', 'ne', 3)).lastInsertRowid;

  // Farms
  const insFarm = (...v) =>
    run(`INSERT INTO farms (farm_id, farmer_id, name, location, latitude, longitude, size, size_unit, soil_type)
         VALUES (?,?,?,?,?,?,?,?,?)`, v);
  await insFarm('KISAN-001', ramId, 'Home Vegetable Field', 'Chitwan, Bharatpur-10', 27.6766, 84.4377, 5, 'ropani', 'Clay');
  await insFarm('KISAN-002', ramId, 'Mango Orchard', 'Chitwan, Bharatpur-12', 27.69, 84.45, 12, 'ropani', 'Loam');
  await insFarm('KISAN-003', gitaId, 'Hillside Paddy', 'Kavre, Dhulikhel', 27.62, 85.55, 8, 'ropani', 'Silt');

  // Crops — the spec's 20 tomato plants on KISAN-001.
  const insCrop = (...v) =>
    run(`INSERT INTO crops (farm_id, farmer_id, name, category, planted_date, plant_count, growth_stage,
           watering_schedule, fertilizer_used, disease_history, growth_status, harvest_date, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, v);
  const tomatoId = (await insCrop('KISAN-001', ramId, 'Tomato', 'vegetable', '2026-06-10', 20, 'Flowering',
    'Every 2 days', 'Organic fertilizer', 'None', 'Healthy', '2026-09-15', 'Polyhouse grown.')).lastInsertRowid;
  await insCrop('KISAN-001', ramId, 'Cauliflower', 'vegetable', '2026-05-20', 30, 'Vegetative',
    'Every 3 days', 'Vermicompost', 'None', 'Healthy', '2026-08-10', null);
  const mangoId = (await insCrop('KISAN-002', ramId, 'Mango', 'tree', '2022-03-01', 15, 'Mature',
    'Weekly', 'NPK 10-10-10', 'Anthracnose (2024)', 'Healthy', '2026-07-01', 'Maldah variety.')).lastInsertRowid;
  await insCrop('KISAN-003', gitaId, 'Rice', 'plant', '2026-06-01', 0, 'Transplanting',
    'Flooded', 'Urea + DAP', 'None', 'Healthy', '2026-10-20', null);
  await insCrop('KISAN-003', gitaId, 'Cow', 'animal', '2024-01-01', 2, 'Adult',
    'N/A', 'N/A', 'None', 'Healthy', null, 'Dairy cattle.');

  // A sample update on the tomato crop.
  await run(`INSERT INTO updates (crop_id, farmer_id, details, images) VALUES (?,?,?,?)`,
    [tomatoId, ramId, JSON.stringify({ growth_stage: 'Flowering', notes: 'Buds appearing, looking healthy.' }), JSON.stringify([])]);

  // Market prices
  for (const r of [
    ['Tomato', 'vegetable', 'Kalimati', 65, 'per kg', 'up'],
    ['Cauliflower', 'vegetable', 'Kalimati', 40, 'per kg', 'down'],
    ['Potato', 'vegetable', 'Kalimati', 45, 'per kg', 'stable'],
    ['Rice (Coarse)', 'plant', 'Birgunj', 58, 'per kg', 'stable'],
    ['Mango', 'tree', 'Kalimati', 120, 'per kg', 'up'],
    ['Milk', 'animal', 'Local Dairy', 75, 'per litre', 'stable'],
  ]) {
    await run(`INSERT INTO market_prices (crop_name, category, market_name, price, unit, trend) VALUES (?,?,?,?,?,?)`, r);
  }

  // Weather snapshots
  const insW = (...v) => run(`INSERT INTO weather (location, temperature, humidity, rain_prediction, condition, alert) VALUES (?,?,?,?,?,?)`, v);
  await insW('Chitwan', 31, 78, '60% chance tomorrow', 'Partly Cloudy', 'High humidity — watch for fungal disease on tomato.');
  await insW('Kavre', 24, 70, 'Light rain expected', 'Cloudy', 'Good conditions for paddy transplanting.');

  // Notifications (broadcast + targeted)
  const insN = (...v) => run(`INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)`, v);
  await insN(null, 'rain', '🌧 Rain Alert', 'Heavy rain expected in Chitwan tomorrow. Protect young seedlings.');
  await insN(null, 'general', '📢 Govt Scheme', 'Subsidy on drip irrigation now open — apply at your ward office.');
  await insN(ramId, 'fertilizer', '🌱 Fertilizer Reminder', 'Time to apply potassium to your flowering tomatoes.');
  await insN(ramId, 'harvest', '🌾 Harvest Reminder', 'Your mango (KISAN-002) is near harvest window.');

  // Sales history for Ram — spread across the last 6 months for a full chart.
  const ym = (monthsAgo, day) => {
    const d = new Date();
    d.setMonth(d.getMonth() - monthsAgo, day);
    return d.toISOString().slice(0, 10);
  };
  for (const [cid, product, cat, qty, unit, price, buyer, monthsAgo, day] of [
    [tomatoId, 'Tomato', 'vegetable', 120, 'kg', 60, 'Kalimati Market', 5, 12],
    [tomatoId, 'Tomato', 'vegetable', 90, 'kg', 62, 'Local Trader', 4, 20],
    [null, 'Cauliflower', 'vegetable', 80, 'kg', 38, 'Kalimati Market', 3, 8],
    [mangoId, 'Mango', 'tree', 200, 'kg', 110, 'Wholesaler', 2, 15],
    [null, 'Cauliflower', 'vegetable', 60, 'kg', 42, 'Local Trader', 1, 10],
    [tomatoId, 'Tomato', 'vegetable', 150, 'kg', 65, 'Kalimati Market', 0, 5],
    [tomatoId, 'Tomato', 'vegetable', 70, 'kg', 64, 'Local Trader', 0, 18],
  ]) {
    await run(
      `INSERT INTO sales (farmer_id, crop_id, product, category, quantity, unit, price_per_unit, total_amount, buyer, sale_date)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [ramId, cid, product, cat, qty, unit, price, qty * price, buyer, ym(monthsAgo, day)]
    );
  }

  // Expense history for Ram — workers, fertilizer, seed, plants across months.
  for (const [cat, desc, workers, qty, unit, rate, monthsAgo, day] of [
    // category, description, workers, quantity, unit, rate, monthsAgo, day
    ['seed', 'Tomato seeds', null, 200, 'gram', 8, 5, 6],
    ['plants', 'Tomato saplings', null, 200, 'piece', 5, 5, 7],
    ['wages', 'Land preparation labour', 6, null, 'day', 800, 5, 8],
    ['fertilizer', 'Organic compost', null, 10, 'bag', 450, 4, 10],
    ['wages', 'Transplanting workers', 8, null, 'day', 800, 4, 12],
    ['pesticide', 'Neem-based spray', null, 5, 'litre', 320, 3, 9],
    ['wages', 'Weeding & care', 4, null, 'day', 750, 2, 11],
    ['fertilizer', 'Urea top-dressing', null, 4, 'bag', 1400, 1, 8],
    ['transport', 'Carriage to Kalimati market', null, null, null, 2500, 0, 6],
    ['wages', 'Harvest workers', 10, null, 'day', 850, 0, 14],
  ]) {
    const amount = workers != null ? workers * rate : qty != null ? qty * rate : rate;
    await run(
      `INSERT INTO expenses (farmer_id, crop_id, category, description, workers, quantity, unit, rate, amount, expense_date, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [ramId, null, cat, desc, workers, qty, unit, rate, amount, ym(monthsAgo, day), null]
    );
  }

  // Marketplace ("Bazar") demo listings — local Taplejung products.
  for (const r of [
    [ramId, 'Fresh Tomatoes', 'vegetable', 'Polyhouse-grown, pesticide-free tomatoes.', 60, 'kg', 120, 'Phungling, Taplejung', '9822222222'],
    [ramId, 'Organic Cauliflower', 'vegetable', 'Freshly harvested cauliflower.', 40, 'kg', 80, 'Phungling, Taplejung', '9822222222'],
    [gitaId, 'Local Chicken (Khasi)', 'animal', 'Healthy free-range local chicken.', 800, 'piece', 10, 'Dhungesanghu, Taplejung', '9833333333'],
    [gitaId, 'Fresh Cow Milk', 'dairy', 'Daily fresh milk from grass-fed cows.', 90, 'litre', 30, 'Dhungesanghu, Taplejung', '9833333333'],
    [gitaId, 'Large Cardamom (Alaichi)', 'grain', 'Premium Taplejung large cardamom, sun-dried.', 1200, 'kg', 25, 'Taplejung', '9833333333'],
    [ramId, 'Allo Handicraft Bag', 'handicraft', 'Handwoven nettle (allo) fibre bag.', 1500, 'piece', 6, 'Phungling, Taplejung', '9822222222'],
  ]) {
    await run(
      `INSERT INTO products (seller_id, title, category, description, price, unit, quantity, location, contact)
       VALUES (?,?,?,?,?,?,?,?,?)`, r
    );
  }

  // Sample chat thread
  const insMsg = (...v) => run(`INSERT INTO messages (farmer_id, expert_id, sender_role, text, image) VALUES (?,?,?,?,?)`, v);
  await insMsg(ramId, null, 'farmer', 'My tomato leaves are turning yellow. What should I do?', null);
  await insMsg(ramId, expertId, 'expert', 'Likely nitrogen deficiency. Apply urea (46-0-0) and a 2% urea foliar spray. Send a photo if it spreads.', null);

  // Disease detections — two Ward-3 farmers with the SAME disease => an outbreak
  // the admin's early-warning screen will flag.
  const insDet = (...v) => run(
    `INSERT INTO disease_detections (farmer_id, crop_id, disease_name, symptoms, cause, treatment, fertilizer, prevention, confidence)
     VALUES (?,?,?,?,?,?,?,?,?)`, v);
  const blight = [
    'Early Blight (Alternaria solani)',
    'Brown concentric-ring spots on older leaves; yellowing around lesions.',
    'Fungal infection favoured by warm, humid weather and leaf wetness.',
    'Remove affected leaves; apply Mancozeb or copper fungicide every 7–10 days.',
    'Balanced NPK with extra potassium to strengthen plants.',
    'Crop rotation, drip irrigation to keep foliage dry, adequate spacing.',
    0.88,
  ];
  await insDet(ramId, tomatoId, ...blight);
  await insDet(bhimId, null, ...blight);

  console.log('✅ Seed complete.');
  console.log('\nDemo logins (identifier / password):');
  console.log('  Super Admin : 9800000000 / admin123');
  console.log('  Expert      : 9811111111 / expert123');
  console.log('  Farmer (Ram): 9822222222 / farmer123');
  console.log('  Farmer (Gita): 9833333333 / farmer123');

  // Quick sanity: confirm QR images render.
  await QRCode.toString(`${BASE_URL}/scan/test`, { type: 'terminal', small: true }).catch(() => {});
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
