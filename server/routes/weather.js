/**
 * Weather.
 *  - GET /api/weather?lat=&lon=&location=
 *      With lat/lon -> live data from Open-Meteo (free, no API key) for that
 *      exact place, incl. a 7-day forecast for the chart and a farming alert.
 *      Without coords -> falls back to the latest stored snapshot.
 *  - GET /api/weather/all   (admin) stored snapshots
 *  - POST /api/weather      (admin) add a snapshot
 *
 * Open-Meteo: https://open-meteo.com/ — uses national weather models, global.
 */
const express = require('express');
const { get, all, run } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

/* Map WMO weather codes -> human condition + a Lucide icon name. */
const WMO = {
  0: ['Clear sky', 'sun'],
  1: ['Mainly clear', 'sun'], 2: ['Partly cloudy', 'cloud-sun'], 3: ['Overcast', 'cloud'],
  45: ['Fog', 'cloud-fog'], 48: ['Rime fog', 'cloud-fog'],
  51: ['Light drizzle', 'cloud-drizzle'], 53: ['Drizzle', 'cloud-drizzle'], 55: ['Heavy drizzle', 'cloud-drizzle'],
  56: ['Freezing drizzle', 'cloud-drizzle'], 57: ['Freezing drizzle', 'cloud-drizzle'],
  61: ['Light rain', 'cloud-rain'], 63: ['Rain', 'cloud-rain'], 65: ['Heavy rain', 'cloud-rain-wind'],
  66: ['Freezing rain', 'cloud-rain'], 67: ['Freezing rain', 'cloud-rain-wind'],
  71: ['Light snow', 'cloud-snow'], 73: ['Snow', 'cloud-snow'], 75: ['Heavy snow', 'cloud-snow'],
  77: ['Snow grains', 'cloud-snow'],
  80: ['Rain showers', 'cloud-rain'], 81: ['Rain showers', 'cloud-rain'], 82: ['Violent showers', 'cloud-rain-wind'],
  85: ['Snow showers', 'cloud-snow'], 86: ['Snow showers', 'cloud-snow'],
  95: ['Thunderstorm', 'cloud-lightning'], 96: ['Thunderstorm + hail', 'cloud-lightning'], 99: ['Thunderstorm + hail', 'cloud-lightning'],
};
const codeInfo = (c) => WMO[c] || ['—', 'cloud'];

/* A short, crop-relevant alert from the current conditions. */
function farmingAlert({ humidity, rainProb, temp, code }) {
  if (code >= 95) return 'Thunderstorm risk — secure young plants and avoid spraying.';
  if (rainProb >= 70 || (code >= 61 && code <= 82)) return 'Rain likely — hold off on irrigation and fertilizer application.';
  if (humidity >= 80) return 'High humidity — watch for fungal disease; ensure good airflow.';
  if (temp >= 35) return 'High heat — water early morning/evening to reduce stress.';
  if (temp <= 5) return 'Cold conditions — protect seedlings from frost.';
  return 'Conditions look good for routine field work.';
}

/* In-memory cache so we don't hammer the API on every page load. */
const cache = new Map();
const TTL_MS = 15 * 60 * 1000;

async function fetchJson(url, timeoutMs = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'KisanSathi/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function reverseGeocode(lat, lon) {
  try {
    const j = await fetchJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    return j.city || j.locality || j.principalSubdivision || j.countryName || 'Your location';
  } catch { return 'Your location'; }
}

async function liveWeather(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m`
    + `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code`
    + `&forecast_days=7&timezone=auto`;

  const [data, location] = await Promise.all([fetchJson(url), reverseGeocode(lat, lon)]);
  const cur = data.current || {};
  const d = data.daily || {};
  const code = cur.weather_code;
  const [condition, icon] = codeInfo(code);
  const todayRainProb = (d.precipitation_probability_max || [])[0] ?? null;

  const forecast = (d.time || []).map((date, i) => {
    const [cond, ic] = codeInfo(d.weather_code[i]);
    return {
      date,
      label: new Date(date).toLocaleDateString('en', { weekday: 'short' }),
      tmax: Math.round(d.temperature_2m_max[i]),
      tmin: Math.round(d.temperature_2m_min[i]),
      rain: d.precipitation_probability_max[i] ?? 0,
      condition: cond, icon: ic,
    };
  });

  const weather = {
    location,
    temperature: Math.round(cur.temperature_2m),
    humidity: Math.round(cur.relative_humidity_2m),
    wind: Math.round(cur.wind_speed_10m),
    condition, icon,
    rain_prediction: todayRainProb != null ? `${todayRainProb}% chance today` : null,
    alert: farmingAlert({ humidity: cur.relative_humidity_2m, rainProb: todayRainProb || 0, temp: cur.temperature_2m, code }),
    live: true,
    updated_at: cur.time || new Date().toISOString(),
  };

  const result = { weather, forecast };
  cache.set(key, { at: Date.now(), data: result });
  return result;
}

/** GET /api/weather?lat=&lon=&location= */
router.get('/', authRequired, async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    try {
      return res.json(await liveWeather(lat, lon));
    } catch (e) {
      // Network/API failure — fall through to stored snapshot below.
      console.warn('Live weather failed, using stored snapshot:', e.message);
    }
  }

  const { location } = req.query;
  const row = location
    ? await get(`SELECT * FROM weather WHERE location = ? ORDER BY date DESC LIMIT 1`, [location])
    : await get(`SELECT * FROM weather ORDER BY date DESC LIMIT 1`);
  res.json({ weather: row || null, forecast: [] });
});

/** GET /api/weather/all -> recent snapshots (admin dashboard) */
router.get('/all', authRequired, requireRole('super_admin'), async (_req, res) => {
  res.json({ weather: await all(`SELECT * FROM weather ORDER BY date DESC LIMIT 100`) });
});

/** POST /api/weather (admin) */
router.post('/', authRequired, requireRole('super_admin'), async (req, res) => {
  const { location, temperature, humidity, rain_prediction, condition, alert } = req.body || {};
  if (!location) return res.status(400).json({ error: 'location is required' });
  const info = await run(
    `INSERT INTO weather (location, temperature, humidity, rain_prediction, condition, alert)
     VALUES (?,?,?,?,?,?)`,
    [location, temperature ?? null, humidity ?? null, rain_prediction || null, condition || null, alert || null]
  );
  res.status(201).json({ weather: await get(`SELECT * FROM weather WHERE id = ?`, [info.lastInsertRowid]) });
});

module.exports = router;
