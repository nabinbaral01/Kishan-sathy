/**
 * Self-signed TLS certificate for local/LAN HTTPS.
 * --------------------------------------------------
 * Camera access (getUserMedia) requires a secure context, so phones reaching
 * the app over the LAN IP need HTTPS. We generate a self-signed cert that
 * covers localhost + the machine's current LAN IP and cache it on disk so the
 * same cert is reused across restarts (avoids re-accepting the warning each run).
 */
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');
const { getLanIp } = require('./helpers');

const CERT_DIR = path.join(__dirname, '..', 'data', 'certs');

/** Resolves to { key, cert } PEM strings, generating + caching them if needed. */
async function ensureCert() {
  const lanIp = getLanIp();
  const keyPath = path.join(CERT_DIR, 'key.pem');
  const certPath = path.join(CERT_DIR, 'cert.pem');
  const metaPath = path.join(CERT_DIR, 'meta.json');

  // Reuse a cached cert only if it still covers the current LAN IP.
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (meta.lanIp === lanIp && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      return { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') };
    }
  } catch { /* no/invalid cache — regenerate below */ }

  const altNames = [
    { type: 2, value: 'localhost' },        // DNS
    { type: 7, ip: '127.0.0.1' },           // IP
  ];
  if (lanIp && lanIp !== 'localhost') altNames.push({ type: 7, ip: lanIp });

  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate.getTime() + 3650 * 24 * 60 * 60 * 1000);
  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: lanIp || 'localhost' }],
    {
      notBeforeDate,
      notAfterDate,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames }],
    }
  );

  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(metaPath, JSON.stringify({ lanIp, created: new Date().toISOString() }));

  return { key: pems.private, cert: pems.cert };
}

module.exports = { ensureCert };
