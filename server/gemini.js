/**
 * Minimal Google Gemini client (REST, no SDK — uses Node's built-in fetch).
 * Free tier: https://aistudio.google.com/app/apikey
 *
 * Exposes:
 *   isEnabled()                       -> true if a key is configured
 *   diagnoseCrop({cropName,symptom,image}) -> structured disease diagnosis
 *   chat(messages)                    -> a plain-text reply (for AI expert chat)
 */
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

const isEnabled = () => Boolean(API_KEY);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One POST attempt. Returns { ok, status, data }. */
async function attempt(body, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(ENDPOINT(MODEL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } finally { clearTimeout(t); }
}

/**
 * POST to Gemini with automatic retries. The free tier frequently returns
 * 503 "model overloaded" — these are transient, so we back off and retry.
 */
async function call(body, { timeoutMs = 20000, retries = 4 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const { ok, status, data } = await attempt(body, timeoutMs);
      if (ok) return data;
      const msg = data?.error?.message || `Gemini HTTP ${status}`;
      // Retry only transient overload (503). Fail fast on quota (429), auth,
      // and bad requests — retrying those just wastes the daily free budget.
      if (status === 503) { lastErr = new Error(msg); }
      else throw new Error(msg);
    } catch (e) {
      lastErr = e; // network/abort errors are also worth a retry
    }
    if (i < retries) await sleep(800 * Math.pow(2, i)); // 0.8s, 1.6s, 3.2s, 6.4s
  }
  throw lastErr || new Error('Gemini request failed');
}

/** Pull the text out of the first candidate. */
function firstText(data) {
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') || '';
}

/** Split a data-URL ("data:image/jpeg;base64,AAAA") into {mimeType, data}. */
function parseDataUrl(image) {
  if (!image || typeof image !== 'string') return null;
  const m = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

const DIAGNOSIS_SCHEMA = {
  type: 'object',
  properties: {
    disease_name: { type: 'string' },
    symptoms: { type: 'string' },
    cause: { type: 'string' },
    treatment: { type: 'string' },
    fertilizer: { type: 'string' },
    prevention: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['disease_name', 'symptoms', 'cause', 'treatment', 'fertilizer', 'prevention', 'confidence'],
};

/**
 * Diagnose a crop problem from an optional photo + crop name + reported symptom.
 * Returns an object matching DIAGNOSIS_SCHEMA. Throws if the API call fails.
 */
async function diagnoseCrop({ cropName = '', symptom = '', image = '' }) {
  const parts = [{
    text:
      `You are an expert agricultural plant pathologist advising a smallholder farmer in Nepal.\n` +
      `Crop: ${cropName || 'unknown'}.\n` +
      `Farmer's reported symptom: ${symptom || '(none given)'}.\n` +
      (image ? `Analyse the attached plant photo.\n` : `No photo was provided; reason from the crop and symptom.\n`) +
      `Identify the most likely disease or deficiency (or say it looks healthy). ` +
      `Give practical, locally-feasible advice. Keep every field short (1-2 sentences). ` +
      `confidence is your certainty from 0 to 1.`,
  }];

  const img = parseDataUrl(image);
  if (img) parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });

  const data = await call({
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: DIAGNOSIS_SCHEMA, temperature: 0.2 },
  });

  const text = firstText(data);
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('Gemini returned non-JSON diagnosis'); }

  // Clamp confidence to [0,1].
  let c = Number(parsed.confidence);
  if (!Number.isFinite(c)) c = 0.7;
  parsed.confidence = Math.max(0, Math.min(1, c));
  return parsed;
}

/**
 * Plain-text chat reply. `messages` = [{ role:'farmer'|'expert', text, image? }].
 * A message may carry an `image` data-URL (farmer photos) which is sent to
 * Gemini vision alongside the text. Returns a string. Throws on failure.
 */
async function chat(messages = []) {
  const contents = messages
    .filter((m) => m.text || m.image)
    .map((m) => {
      const parts = [];
      if (m.text) parts.push({ text: m.text });
      const img = parseDataUrl(m.image);
      if (img) parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
      return { role: m.role === 'farmer' ? 'user' : 'model', parts };
    })
    .filter((c) => c.parts.length);

  const data = await call({
    systemInstruction: {
      parts: [{
        text: 'You are Kisan Sathi, a friendly farming assistant for Nepali smallholder farmers. ' +
          'Give short, practical, safe advice on crops, soil, pests, fertilizer and weather. ' +
          'Reply in the same language the farmer used (English or Nepali).',
      }],
    },
    contents,
    generationConfig: { temperature: 0.4 },
  });
  return firstText(data).trim();
}

module.exports = { isEnabled, diagnoseCrop, chat };
