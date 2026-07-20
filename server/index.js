/**
 * Kisan Sathi — Smart Agriculture Platform
 * Express API server + thin static UI.
 */
const path = require('path');
const os = require('os');
const https = require('https');
const express = require('express');
require('express-async-errors'); // route async throws to the error middleware
const cors = require('cors');
const QRCode = require('qrcode');
require('dotenv').config();

const { ensureReady } = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '8mb' })); // base64 images can be large
app.use(express.urlencoded({ extended: true }));

// Ensure the database schema exists before handling any request. `ensureReady`
// is memoized, so this only does real work once per process (important on
// serverless, where each cold start gets a fresh process).
app.use(async (_req, _res, next) => {
  await ensureReady();
  next();
});

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'Kisan Sathi', time: new Date().toISOString() }));

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/farms', require('./routes/farms'));
app.use('/api/crops', require('./routes/crops'));
app.use('/api/updates', require('./routes/updates'));
app.use('/api/disease', require('./routes/disease'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/experts', require('./routes/experts'));
app.use('/api/market', require('./routes/market'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/products', require('./routes/products'));
app.use('/api/subsidies', require('./routes/subsidies'));
app.use('/api/beneficiaries', require('./routes/beneficiaries'));
app.use('/api/feed', require('./routes/feed'));
app.use('/api/weather', require('./routes/weather'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/analytics', require('./routes/analytics'));

// Static thin UI. Disable caching so the browser always loads the latest
// HTML/JS/CSS during development (avoids stale-cache confusion).
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

// SPA fallback for client-side routes (e.g. /scan/:code) — non-API only.
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// JSON 404 for unknown API endpoints
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found' }));

// Central error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

/** Find this machine's first non-internal IPv4 address (LAN IP). */
function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const HTTPS_PORT = process.env.HTTPS_PORT || 4443;

// On Vercel (and any serverless host) we DON'T start our own listener — the
// platform wraps `app` as a function. The block below only runs for local
// `npm start`, where it also spins up an HTTPS listener so phones on the LAN get
// a secure context (needed for the camera).
if (!process.env.VERCEL) startLocalServer();

function startLocalServer() {
  const { ensureCert } = require('./tls');
  // Bind to 0.0.0.0 so phones on the same Wi-Fi can reach it.
  app.listen(PORT, '0.0.0.0', async () => {
  const lanIp = getLanIp();

  // HTTPS listener — required so phones (reaching the app via the LAN IP) get a
  // secure context and can use the camera. Falls back to HTTP-only if the cert
  // can't be created.
  let httpsUp = false;
  try {
    const { key, cert } = await ensureCert();
    await new Promise((resolve, reject) => {
      const s = https.createServer({ key, cert }, app);
      s.on('error', reject);
      s.listen(HTTPS_PORT, '0.0.0.0', resolve);
    });
    httpsUp = true;
  } catch (e) {
    console.warn('   ⚠️  Could not start HTTPS (camera on phone will be unavailable):', e.message);
  }

  const phoneUrl = httpsUp ? `https://${lanIp}:${HTTPS_PORT}` : `http://${lanIp}:${PORT}`;

  console.log(`\n🌾 Kisan Sathi is running!\n`);
  console.log(`   On this computer : http://localhost:${PORT}`);
  if (httpsUp) console.log(`   Secure (camera)  : https://localhost:${HTTPS_PORT}`);
  console.log(`   On your phone    : ${phoneUrl}   (same Wi-Fi required)\n`);

  if (lanIp !== 'localhost') {
    try {
      // Scan this QR with your phone camera to open the app on mobile.
      const qr = await QRCode.toString(phoneUrl, { type: 'terminal', small: true });
      console.log('   📱 Scan this QR with your phone camera:\n');
      console.log(qr);
    } catch { /* ignore QR render errors */ }
    if (httpsUp) {
      console.log('\n   ℹ️  The phone will warn about a self-signed certificate — tap');
      console.log('       "Advanced" → "Proceed" once to trust it, then the camera works.');
    }
  } else {
    console.log('   (No LAN IP found — connect to Wi-Fi to get a phone-scannable address.)\n');
  }
  console.log('\n   First run on Windows may show a Firewall prompt — click "Allow access".\n');
  });
}

module.exports = app;
