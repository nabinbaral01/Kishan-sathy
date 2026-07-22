/**
 * Minimal transactional email sender via Resend (REST, no SDK — Node fetch).
 * Configure with two env vars:
 *   RESEND_API_KEY   your key from https://resend.com/api-keys
 *   EMAIL_FROM       e.g. "Kisan Sathi <onboarding@resend.dev>" (test) or your domain
 *
 * Until a key is set, isEnabled() is false and callers should degrade gracefully.
 */
require('dotenv').config();

const API_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.EMAIL_FROM || 'Kisan Sathi <onboarding@resend.dev>';

const isEnabled = () => Boolean(API_KEY);

async function sendEmail({ to, subject, html }) {
  if (!API_KEY) throw new Error('Email is not configured (RESEND_API_KEY missing)');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.message || data?.error?.message || `Email send failed (HTTP ${r.status})`);
  return data;
}

/** Branded HTML for the password-reset email. */
function resetEmailHtml(name, link) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c2b1c">
    <h2 style="color:#2e7d32;margin:0 0 4px">🌾 Kisan Sathi</h2>
    <p>Hello ${name || 'there'},</p>
    <p>We received a request to reset your Kisan Sathi password. Tap the button below to choose a new one. This link expires in 30 minutes.</p>
    <p style="text-align:center;margin:24px 0">
      <a href="${link}" style="background:#2e7d32;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;display:inline-block;font-weight:bold">Reset my password</a>
    </p>
    <p style="font-size:13px;color:#61706a">If the button doesn't work, copy this link into your browser:<br>
      <a href="${link}" style="color:#2e7d32;word-break:break-all">${link}</a></p>
    <p style="font-size:13px;color:#61706a">If you didn't request this, you can safely ignore this email — your password stays the same.</p>
  </div>`;
}

/** Branded HTML for the 6-digit password-reset code email. */
function resetCodeEmailHtml(name, code) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c2b1c">
    <h2 style="color:#2e7d32;margin:0 0 4px">🌾 Kisan Sathi</h2>
    <p>Hello ${name || 'there'},</p>
    <p>Use this code to reset your Kisan Sathi password:</p>
    <p style="text-align:center;margin:24px 0">
      <span style="display:inline-block;background:#eef5ee;border:1px solid #2e7d32;color:#1b5e20;
        font-size:32px;font-weight:bold;letter-spacing:10px;padding:14px 24px;border-radius:12px">${code}</span>
    </p>
    <p style="font-size:13px;color:#61706a">This code expires in <strong>10 minutes</strong> and can be used once.</p>
    <p style="font-size:13px;color:#61706a">If you didn't request this, ignore this email — your password stays the same. Never share this code with anyone.</p>
  </div>`;
}

/** Welcome / thank-you email sent once, when an account is first created. */
function welcomeEmailHtml(name, appUrl) {
  const url = appUrl || 'https://kisansathi01.vercel.app';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1c2b1c">
    <h2 style="color:#2e7d32;margin:0 0 2px">🌾 Kisan Sathi</h2>
    <p style="color:#61706a;margin:0 0 18px;font-size:13px">Your Smart Farming Partner · तपाईंको स्मार्ट कृषि साथी</p>

    <p><strong>Namaste ${name || 'Kisan'}, thank you for joining Kisan Sathi!</strong></p>
    <p>Your account is ready. Here is what you can do:</p>
    <ul style="padding-left:18px;line-height:1.7">
      <li>🌦️ Check local <strong>weather</strong> and daily <strong>market prices</strong></li>
      <li>🏪 Buy and sell in the <strong>Bazar</strong></li>
      <li>🩺 Get an instant <strong>AI crop-disease diagnosis</strong> from a photo</li>
      <li>🤝 Ask <strong>agriculture experts</strong> and join the <strong>Community Feed</strong></li>
      <li>💰 Apply for <strong>subsidies (अनुदान)</strong> from your Nagarpalika</li>
    </ul>
    <p style="text-align:center;margin:24px 0">
      <a href="${url}" style="background:#2e7d32;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;display:inline-block;font-weight:bold">Open Kisan Sathi</a>
    </p>

    <hr style="border:none;border-top:1px solid #e0e6e0;margin:22px 0"/>
    <p style="font-size:14px"><strong>नमस्ते ${name || 'किसान'}, किसान साथीमा जोडिनुभएकोमा धन्यवाद!</strong></p>
    <p style="font-size:13px;color:#41504a;line-height:1.7">
      तपाईंको खाता तयार छ। अब तपाईं मौसम र बजार भाउ हेर्न, बजारमा किनबेच गर्न,
      फोटोबाट बालीको रोग पत्ता लगाउन, कृषि विशेषज्ञसँग सोध्न र नगरपालिकाबाट
      अनुदानका लागि आवेदन दिन सक्नुहुन्छ।
    </p>
    <p style="font-size:12px;color:#8a968f;margin-top:20px">
      You are receiving this because an account was created with this email address.
      If that wasn't you, you can safely ignore this message.
    </p>
  </div>`;
}

module.exports = { isEnabled, sendEmail, resetEmailHtml, resetCodeEmailHtml, welcomeEmailHtml };
