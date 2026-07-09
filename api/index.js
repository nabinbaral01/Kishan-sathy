// Vercel serverless entry point.
// Vercel auto-detects files in /api as Node functions. We simply re-export the
// Express app; `vercel.json` rewrites every request to this function, so Express
// keeps serving the API, the static UI in /public, and the SPA fallback.
// The app skips its own app.listen() when process.env.VERCEL is set.
module.exports = require('../server/index.js');
