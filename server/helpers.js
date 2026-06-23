/**
 * Shared helpers used across routes.
 */
const os = require('os');
const { get } = require('./db');

/** Find this machine's first non-internal IPv4 (LAN) address. */
function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const LOCAL_HOST_RE = /localhost|127\.0\.0\.1/;

/**
 * Resolve a base URL that a phone on the same Wi-Fi can actually open.
 * Order of preference:
 *   1. An explicit non-local PUBLIC_BASE_URL (e.g. a real domain in production).
 *   2. The host the request came in on, if it isn't localhost (so opening the
 *      app via http://192.168.x.x:PORT yields QR links on that same address).
 *   3. The machine's LAN IP — so even QR codes generated from the computer
 *      (localhost) still encode a phone-scannable address.
 */
function publicBaseUrl(req) {
  const env = process.env.PUBLIC_BASE_URL;
  if (env && !LOCAL_HOST_RE.test(env)) return env.replace(/\/+$/, '');

  const host = req && req.get ? req.get('host') : '';
  if (host && !LOCAL_HOST_RE.test(host)) {
    return `${(req && req.protocol) || 'http'}://${host}`;
  }

  const port = process.env.PORT || 4000;
  return `http://${getLanIp()}:${port}`;
}

/** Generate the next sequential farm id in KISAN-001 format. */
async function nextFarmId() {
  const row = await get(
    `SELECT farm_id FROM farms WHERE farm_id LIKE 'KISAN-%' ORDER BY farm_id DESC LIMIT 1`
  );
  let n = 1;
  if (row) {
    const parsed = parseInt(String(row.farm_id).split('-')[1], 10);
    if (!Number.isNaN(parsed)) n = parsed + 1;
  }
  return `KISAN-${String(n).padStart(3, '0')}`;
}

/**
 * Returns true if the given user may access the farm.
 * Super admin can access everything; a farmer only their own farms.
 */
function canAccessFarm(user, farm) {
  if (!farm) return false;
  if (user.role === 'super_admin') return true;
  return user.role === 'farmer' && farm.farmer_id === user.id;
}

/** Random opaque token for QR codes. */
function randomToken(len = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

module.exports = { nextFarmId, canAccessFarm, randomToken, getLanIp, publicBaseUrl };
