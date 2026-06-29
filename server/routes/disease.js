/**
 * AI Crop Disease Detection.
 *
 * NOTE: This is a deterministic stub standing in for a real CNN model. It picks a
 * plausible diagnosis from a small knowledge base (optionally biased by the crop
 * name / reported symptom) so the full request->store->history flow works end to
 * end. Swap `diagnose()` for a model inference call to make it real.
 */
const express = require('express');
const { get, all, run } = require('../db');
const { authRequired } = require('../middleware/auth');
const gemini = require('../gemini');

const router = express.Router();

const KNOWLEDGE_BASE = [
  {
    match: ['tomato', 'potato', 'leaf', 'yellow', 'blight'],
    disease_name: 'Early Blight (Alternaria solani)',
    symptoms: 'Brown concentric-ring spots on older leaves; yellowing around lesions.',
    cause: 'Fungal infection favoured by warm, humid weather and leaf wetness.',
    treatment: 'Remove affected leaves; apply Mancozeb or copper-based fungicide every 7–10 days.',
    fertilizer: 'Balanced NPK with extra potassium to strengthen plants.',
    prevention: 'Crop rotation, drip irrigation to keep foliage dry, adequate spacing.',
    confidence: 0.88,
  },
  {
    match: ['yellow', 'pale', 'nitrogen', 'stunted'],
    disease_name: 'Nitrogen Deficiency',
    symptoms: 'Uniform yellowing of older leaves, stunted growth, thin stems.',
    cause: 'Insufficient available nitrogen in the soil.',
    treatment: 'Apply urea or well-rotted manure; foliar spray of 2% urea solution.',
    fertilizer: 'Urea (46-0-0) or organic compost rich in nitrogen.',
    prevention: 'Regular soil testing, green manure, balanced fertilization schedule.',
    confidence: 0.81,
  },
  {
    match: ['rust', 'orange', 'wheat', 'maize', 'spots'],
    disease_name: 'Leaf Rust (Puccinia)',
    symptoms: 'Orange-brown pustules on leaf surfaces that rub off as powder.',
    cause: 'Fungal spores spread by wind in cool, moist conditions.',
    treatment: 'Spray Propiconazole or Tebuconazole at first sign.',
    fertilizer: 'Avoid excess nitrogen; maintain balanced potassium.',
    prevention: 'Plant resistant varieties, avoid dense canopies, remove volunteer plants.',
    confidence: 0.84,
  },
  {
    match: ['curl', 'virus', 'whitefly', 'mosaic', 'chilli'],
    disease_name: 'Leaf Curl Virus',
    symptoms: 'Upward curling, crinkling and thickening of leaves; stunted plants.',
    cause: 'Virus transmitted by whiteflies.',
    treatment: 'Remove and destroy infected plants; control whiteflies with neem oil / imidacloprid.',
    fertilizer: 'Micronutrient mix (zinc + boron) to aid recovery.',
    prevention: 'Use virus-free seedlings, yellow sticky traps, reflective mulch.',
    confidence: 0.78,
  },
  {
    match: ['rot', 'wilt', 'root', 'fungus', 'brown'],
    disease_name: 'Root Rot / Wilt (Fusarium)',
    symptoms: 'Wilting despite moist soil; brown, mushy roots; lower-leaf yellowing.',
    cause: 'Soil-borne fungus thriving in waterlogged conditions.',
    treatment: 'Improve drainage; drench with Carbendazim; remove severely affected plants.',
    fertilizer: 'Add Trichoderma-enriched compost to suppress the pathogen.',
    prevention: 'Avoid overwatering, raised beds, crop rotation with non-hosts.',
    confidence: 0.8,
  },
];

const HEALTHY = {
  disease_name: 'No Disease Detected (Healthy)',
  symptoms: 'No visible disease symptoms.',
  cause: '—',
  treatment: 'Continue current care routine.',
  fertilizer: 'Maintain balanced NPK as per crop stage.',
  prevention: 'Regular monitoring, proper watering and weeding.',
  confidence: 0.7,
};

/** Pick the best-matching entry from the knowledge base. */
function diagnose({ cropName = '', symptom = '' }) {
  const hay = `${cropName} ${symptom}`.toLowerCase();
  let best = null, bestScore = 0;
  for (const entry of KNOWLEDGE_BASE) {
    const score = entry.match.reduce((s, kw) => (hay.includes(kw) ? s + 1 : s), 0);
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  if (best && bestScore > 0) { const { match, ...rest } = best; return rest; }
  // Fall back to a deterministic pick so demos are stable but varied.
  if (symptom) { const { match, ...rest } = KNOWLEDGE_BASE[hay.length % KNOWLEDGE_BASE.length]; return rest; }
  return { ...HEALTHY };
}

/**
 * POST /api/disease/detect  { image?, crop_id?, crop_name?, symptom? }
 * Returns a diagnosis and stores it in history.
 */
router.post('/detect', authRequired, async (req, res) => {
  const { image, crop_id, crop_name, symptom } = req.body || {};

  let cropName = crop_name || '';
  if (crop_id) {
    const crop = await get(`SELECT * FROM crops WHERE crop_id = ?`, [Number(crop_id)]);
    if (crop) {
      if (req.user.role !== 'super_admin' && crop.farmer_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      cropName = cropName || crop.name;
    }
  }

  // Real AI diagnosis via Gemini when configured; otherwise the built-in stub.
  let result, source = 'demo';
  if (gemini.isEnabled()) {
    try {
      result = await gemini.diagnoseCrop({ cropName, symptom, image });
      source = 'gemini';
    } catch (e) {
      console.warn('Gemini diagnosis failed, falling back to stub:', e.message);
    }
  }
  if (!result) result = diagnose({ cropName, symptom });

  const info = await run(
    `INSERT INTO disease_detections
       (farmer_id, crop_id, image, disease_name, symptoms, cause, treatment, fertilizer, prevention, confidence)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      req.user.id, crop_id || null, image || null,
      result.disease_name, result.symptoms, result.cause,
      result.treatment, result.fertilizer, result.prevention, result.confidence,
    ]
  );

  res.status(201).json({
    detection: await get(`SELECT * FROM disease_detections WHERE id = ?`, [info.lastInsertRowid]),
    source, // 'gemini' (real AI) or 'demo' (built-in stub)
  });
});

/** GET /api/disease/history -> past detections for the user */
router.get('/history', authRequired, async (req, res) => {
  const rows = req.user.role === 'super_admin'
    ? await all(`SELECT * FROM disease_detections ORDER BY created_at DESC LIMIT 200`)
    : await all(`SELECT * FROM disease_detections WHERE farmer_id = ? ORDER BY created_at DESC`, [req.user.id]);
  res.json({ detections: rows });
});

module.exports = router;
