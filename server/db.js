/**
 * Kisan Sathi - Database layer
 * --------------------------------
 * Uses Turso / libSQL (SQLite-compatible) over the network so data persists on a
 * serverless host (Vercel). The SQL and schema are identical to plain SQLite; only
 * the client API is async.
 *
 * Exposes thin async helpers that mirror how the routes used better-sqlite3 /
 * node:sqlite:  get() -> one row, all() -> rows, run() -> { lastInsertRowid, changes }.
 * `ensureReady()` lazily creates the schema once per process (memoized).
 */
const { createClient } = require('@libsql/client');
require('dotenv').config();

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  throw new Error(
    'TURSO_DATABASE_URL is not set. Create a Turso database and set ' +
      'TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN) in your environment / .env.'
  );
}

const client = createClient({ url, authToken });

/** Build a clean plain object from a libSQL row using the result column names. */
function rowToObject(row, columns) {
  const obj = {};
  for (const name of columns) obj[name] = row[name];
  return obj;
}

/** Run a query returning all rows as plain objects. */
async function all(sql, params = []) {
  const rs = await client.execute({ sql, args: params });
  return rs.rows.map((r) => rowToObject(r, rs.columns));
}

/** Run a query returning the first row (or undefined). */
async function get(sql, params = []) {
  const rs = await client.execute({ sql, args: params });
  return rs.rows.length ? rowToObject(rs.rows[0], rs.columns) : undefined;
}

/** Run a write. Returns { lastInsertRowid, changes } like better-sqlite3. */
async function run(sql, params = []) {
  const rs = await client.execute({ sql, args: params });
  return {
    lastInsertRowid:
      rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : undefined,
    changes: rs.rowsAffected,
  };
}

/** Execute one or more `;`-separated statements (used for schema creation). */
async function exec(sql) {
  await client.executeMultiple(sql);
}

/**
 * Run `fn` inside a write transaction. `fn` receives a tx object exposing the same
 * get/all/run helpers, and is committed on success / rolled back on error.
 */
async function transaction(fn) {
  const tx = await client.transaction('write');
  try {
    const txGet = async (sql, params = []) => {
      const rs = await tx.execute({ sql, args: params });
      return rs.rows.length ? rowToObject(rs.rows[0], rs.columns) : undefined;
    };
    const txAll = async (sql, params = []) => {
      const rs = await tx.execute({ sql, args: params });
      return rs.rows.map((r) => rowToObject(r, rs.columns));
    };
    const txRun = async (sql, params = []) => {
      const rs = await tx.execute({ sql, args: params });
      return {
        lastInsertRowid:
          rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : undefined,
        changes: rs.rowsAffected,
      };
    };
    const result = await fn({ get: txGet, all: txAll, run: txRun });
    await tx.commit();
    return result;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  }
}

/**
 * Schema. Mirrors the spec's tables (Users, Farm, Crops, QR, Updates, Experts)
 * plus supporting tables for market, weather, notifications, chat and AI disease
 * detection. Designed for farmer-level data privacy: every owned row carries a
 * farmer_id so the API can scope queries per account.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('super_admin','farmer','expert')),
  phone         TEXT UNIQUE,
  email         TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  language      TEXT NOT NULL DEFAULT 'en',
  bio           TEXT,
  address       TEXT,
  avatar        TEXT,
  show_contact  INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experts (
  expert_id      INTEGER PRIMARY KEY,
  specialization TEXT,
  bio            TEXT,
  available      INTEGER NOT NULL DEFAULT 1,
  verified       INTEGER NOT NULL DEFAULT 0,
  proof_image    TEXT,
  FOREIGN KEY (expert_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS farms (
  farm_id     TEXT PRIMARY KEY,
  farmer_id   INTEGER NOT NULL,
  name        TEXT NOT NULL,
  location    TEXT,
  latitude    REAL,
  longitude   REAL,
  size        REAL,
  size_unit   TEXT DEFAULT 'ropani',
  soil_type   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crops (
  crop_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id           TEXT NOT NULL,
  farmer_id         INTEGER NOT NULL,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL CHECK (category IN ('tree','plant','vegetable','animal')),
  planted_date      TEXT,
  plant_count       INTEGER DEFAULT 0,
  growth_stage      TEXT,
  watering_schedule TEXT,
  fertilizer_used   TEXT,
  disease_history   TEXT DEFAULT 'None',
  growth_status     TEXT DEFAULT 'Healthy',
  harvest_date      TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE,
  FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS qr_codes (
  qr_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  farm_id     TEXT NOT NULL,
  crop_id     INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE,
  FOREIGN KEY (crop_id) REFERENCES crops(crop_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS updates (
  update_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  crop_id     INTEGER NOT NULL,
  farmer_id   INTEGER NOT NULL,
  details     TEXT,
  images      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (crop_id) REFERENCES crops(crop_id) ON DELETE CASCADE,
  FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS market_prices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  crop_name   TEXT NOT NULL,
  category    TEXT,
  market_name TEXT,
  price       REAL NOT NULL,
  unit        TEXT DEFAULT 'per kg',
  trend       TEXT DEFAULT 'stable',
  date        TEXT NOT NULL DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS weather (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  location        TEXT NOT NULL,
  temperature     REAL,
  humidity        REAL,
  rain_prediction TEXT,
  condition       TEXT,
  alert           TEXT,
  date            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  type        TEXT NOT NULL DEFAULT 'general',
  title       TEXT NOT NULL,
  message     TEXT,
  link        TEXT,
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id   INTEGER NOT NULL,
  expert_id   INTEGER,
  sender_role TEXT NOT NULL,
  text        TEXT,
  image       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (expert_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sales (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id     INTEGER NOT NULL,
  crop_id       INTEGER,
  product       TEXT NOT NULL,
  category      TEXT,
  quantity      REAL NOT NULL DEFAULT 0,
  unit          TEXT DEFAULT 'kg',
  price_per_unit REAL NOT NULL DEFAULT 0,
  total_amount  REAL NOT NULL DEFAULT 0,
  buyer         TEXT,
  sale_date     TEXT NOT NULL DEFAULT (date('now')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (crop_id) REFERENCES crops(crop_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id     INTEGER NOT NULL,
  crop_id       INTEGER,
  category      TEXT NOT NULL,
  description   TEXT NOT NULL,
  workers       INTEGER,
  quantity      REAL,
  unit          TEXT,
  rate          REAL NOT NULL DEFAULT 0,
  amount        REAL NOT NULL DEFAULT 0,
  expense_date  TEXT NOT NULL DEFAULT (date('now')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (crop_id) REFERENCES crops(crop_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id    INTEGER NOT NULL,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL,
  description  TEXT,
  price        REAL NOT NULL DEFAULT 0,
  unit         TEXT DEFAULT 'piece',
  quantity     REAL DEFAULT 1,
  location     TEXT,
  image        TEXT,
  contact      TEXT,
  status       TEXT NOT NULL DEFAULT 'available',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL,
  buyer_id     INTEGER NOT NULL,
  seller_id    INTEGER NOT NULL,
  quantity     REAL NOT NULL DEFAULT 1,
  total        REAL NOT NULL DEFAULT 0,
  message      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS disease_detections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id    INTEGER NOT NULL,
  crop_id      INTEGER,
  image        TEXT,
  disease_name TEXT,
  symptoms     TEXT,
  cause        TEXT,
  treatment    TEXT,
  fertilizer   TEXT,
  prevention   TEXT,
  confidence   REAL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (crop_id) REFERENCES crops(crop_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_farms_farmer    ON farms(farmer_id);
CREATE INDEX IF NOT EXISTS idx_crops_farmer    ON crops(farmer_id);
CREATE INDEX IF NOT EXISTS idx_crops_farm      ON crops(farm_id);
CREATE INDEX IF NOT EXISTS idx_updates_crop    ON updates(crop_id);
CREATE INDEX IF NOT EXISTS idx_notif_user      ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_farmer ON messages(farmer_id);
CREATE INDEX IF NOT EXISTS idx_sales_farmer    ON sales(farmer_id);
CREATE INDEX IF NOT EXISTS idx_sales_date      ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_expenses_farmer ON expenses(farmer_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date   ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer    ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller   ON orders(seller_id);
`;

/** Add a column if the table doesn't already have it (lightweight migration). */
async function addColumnIfMissing(table, column, definition, onAdd) {
  const cols = await all(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) {
    await exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    if (onAdd) await onAdd();
  }
}

/** Create the schema + run migrations. Idempotent. */
async function initSchema() {
  await exec(SCHEMA_SQL);

  // New experts default to unverified (0). Experts that already existed before this
  // column was introduced are trusted and backfilled as verified (1).
  await addColumnIfMissing('experts', 'verified', 'INTEGER NOT NULL DEFAULT 0', () =>
    exec(`UPDATE experts SET verified = 1`)
  );
  await addColumnIfMissing('experts', 'proof_image', 'TEXT');
  // Deep-link target for notifications (added after launch).
  await addColumnIfMissing('notifications', 'link', 'TEXT');
  // Public profile fields on users (added after launch).
  await addColumnIfMissing('users', 'bio', 'TEXT');
  await addColumnIfMissing('users', 'address', 'TEXT');
  await addColumnIfMissing('users', 'avatar', 'TEXT');
  await addColumnIfMissing('users', 'show_contact', 'INTEGER NOT NULL DEFAULT 1');
  // Ward number (1–11) of Taplejung Nagarpalika the farmer belongs to.
  await addColumnIfMissing('users', 'ward', 'INTEGER');
}

let readyPromise = null;
/**
 * Ensure the schema exists. Memoized so it only runs once per process.
 * In production the schema already exists, so set SKIP_DB_INIT=1 to skip the
 * (many round-trip) schema check on every serverless cold start — a big speed-up.
 * The seed script and local dev still run it (they don't set the flag).
 */
function ensureReady() {
  if (process.env.SKIP_DB_INIT === '1') return Promise.resolve();
  if (!readyPromise) readyPromise = initSchema();
  return readyPromise;
}

module.exports = { client, get, all, run, exec, transaction, ensureReady, initSchema };
