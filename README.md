# 🌾 Kisan Sathi — Your Smart Farming Partner

A full-stack smart agriculture platform: QR-based field tracking, multi-role
accounts (Super Admin / Farmer / Expert), crop & livestock management, AI crop
disease detection, expert chat, market prices, weather and notifications.

This first build is **backend + API first**: a complete, role-aware REST API over
SQLite, plus a thin responsive web UI (works in any phone browser, no app store).

Site Link: https://kisansathi01.vercel.app/
---

## Tech stack

| Layer    | Choice |
|----------|--------|
| Backend  | Node.js + Express |
| Database | SQLite (`better-sqlite3`) — zero external service |
| Auth     | JWT + bcrypt, 3 roles with per-farmer data privacy |
| QR       | `qrcode` dynamic generator (PNG + data-URL) |
| AI       | Disease-detection stub (rule-based knowledge base, swap for a real model) |
| Frontend | Vanilla JS responsive SPA (green farmer-friendly theme) |

---

## Quick start (Windows / macOS / Linux)

```bash
npm install          # installs dependencies
cp .env.example .env # (Windows: copy .env.example .env) — optional, has sane defaults
npm run seed         # creates data/kisan-sathi.db with demo data
npm start            # http://localhost:4000
```

Open **http://localhost:4000** in a browser (or your phone on the same network).

### Demo logins (identifier / password)

| Role         | Login        | Password   |
|--------------|--------------|------------|
| Super Admin  | `9800000000` | `admin123` |
| Expert       | `9811111111` | `expert123`|
| Farmer (Ram) | `9822222222` | `farmer123`|
| Farmer (Gita)| `9833333333` | `farmer123`|

The seed includes the spec's example field **KISAN-001** with **20 tomato plants**.

---

## App flow (matches the spec)

- **Home** → 4 cards: Weather 🌦️ · Farm Update 📢 · Market Price 💰 · Contact Expert 👨‍🌾
- **VIEW** → choose 🌳 Tree / 🌱 Plant / 🥕 Vegetable / 🐄 Animal → QR scanner → full field info
- **UPDATE** → same categories → scanner → edit crop details, fertilizer, watering, disease, harvest…
- **AI Disease Detection** → photo + symptom → diagnosis (disease, cause, treatment, fertilizer, prevention)
- **Expert chat**, **market prices**, **weather**, **notifications**, **admin analytics & user management**

> QR scanning in a browser is simulated by selecting a field's code or pasting it
> (the spec's mobile camera scan maps to this). Each generated QR encodes a deep
> link `/(scan)/:code` that the app resolves to the field record.

---

## API overview

All endpoints are under `/api`. Send `Authorization: Bearer <token>` after login.

| Group | Endpoints |
|-------|-----------|
| Auth  | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Users | `GET /users`, `GET/PATCH /users/:id`, `PATCH /users/:id/status`, `DELETE /users/:id` (admin) |
| Farms | `GET/POST /farms`, `GET/PATCH/DELETE /farms/:farmId` |
| Crops | `GET/POST /crops`, `GET/PATCH/DELETE /crops/:id` (filter `?category=&farmId=`) |
| QR    | `POST /qr/generate`, `GET /qr`, `GET /qr/:code`, `GET /qr/:code/image` |
| Updates | `GET /updates?cropId=`, `POST /updates` (saves history + syncs crop) |
| Disease | `POST /disease/detect`, `GET /disease/history` |
| Chat  | `GET /chat/threads`, `GET /chat/messages`, `POST /chat/messages` |
| Experts | `GET /experts`, `PATCH /experts/me` |
| Market | `GET /market`, `POST/PATCH/DELETE /market/:id` (admin write) |
| Weather | `GET /weather`, `GET /weather/all`, `POST /weather` (admin) |
| Notifications | `GET /notifications`, `POST /notifications` (admin), `PATCH /notifications/:id/read` |
| Analytics | `GET /analytics/summary` (admin) |

### Example

```bash
# login
curl -s localhost:4000/api/auth/login -H "Content-Type: application/json" \
  -d '{"identifier":"9822222222","password":"farmer123"}'

# list my farms (use the token from above)
curl -s localhost:4000/api/farms -H "Authorization: Bearer <TOKEN>"
```

---

## Data privacy model

- **Farmer** sees and edits only rows tied to their `farmer_id` (farms, crops, updates, QR, chat).
- **Expert** sees the expert directory + all farmer chat threads + can diagnose.
- **Super Admin** sees and manages everything (users, market, weather, notifications, analytics).

---

## Database schema

`users`, `experts`, `farms`, `crops`, `qr_codes`, `updates`, `market_prices`,
`weather`, `notifications`, `messages`, `disease_detections`.
Defined in [server/db.js](server/db.js).

---

## Roadmap to "full" vision

- Replace the disease-detection stub in [server/routes/disease.js](server/routes/disease.js) with a real CNN inference call.
- Add live weather + mandi/market price API integrations.
- Real camera QR scanning on the frontend (e.g. `html5-qrcode`) + GPS capture.
- Image upload to object storage (currently base64 inline).
- Package the web app as a PWA / wrap with Capacitor for app stores.
- Full Nepali/English i18n strings (language field already stored per user).
