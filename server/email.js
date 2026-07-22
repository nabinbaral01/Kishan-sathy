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

module.exports = { isEnabled, sendEmail, resetEmailHtml, resetCodeEmailHtml };
