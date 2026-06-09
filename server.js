import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { handleFeature } from './src-server/router.js';

const app  = express();
const PORT = process.env.PORT || 3001;

// Trust Railway's (and most PaaS) reverse proxy so that express-rate-limit
// can read the real client IP from X-Forwarded-For instead of seeing the
// proxy's internal address. Must come before any middleware that uses IPs.
app.set('trust proxy', 1);

// ── Secret scrubbing ──────────────────────────────────────────────────────────
// Never let the API key (or any Bearer token) reach logs or responses.
function scrubSecrets(input) {
  let out = String(input ?? '');
  const key = process.env.GROQ_API_KEY;
  if (key) out = out.split(key).join('[REDACTED]');
  return out
    .replace(/gsk_[A-Za-z0-9]+/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
}

// ── CORS ───────────────────────────────────────────────────────────────────────
// Allow-list (checked in order):
//   1. No Origin header  → server-to-server / Vercel proxy rewrite / curl — always OK.
//   2. localhost:5173    → local Vite dev server.
//   3. *.vercel.app      → every Vercel deployment (production + all preview branches).
//   4. PRODUCTION_ORIGIN → explicit custom domain, if configured.
//   5. Fallback          → if PRODUCTION_ORIGIN is not set, allow all but log a warning
//                          so the first deploy works before the domain is known.
const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (origin === 'http://localhost:5173') return callback(null, true);
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    if (process.env.PRODUCTION_ORIGIN && origin === process.env.PRODUCTION_ORIGIN) {
      return callback(null, true);
    }
    if (!process.env.PRODUCTION_ORIGIN) {
      console.warn(`[CORS] No PRODUCTION_ORIGIN set — allowing origin: ${origin}`);
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
};

app.use(cors(corsOptions));
// Explicitly answer CORS preflight (OPTIONS) for every route.
app.options('*', cors(corsOptions));

// Body parser with a hard 10KB ceiling — the client always truncates the
// journal/chat payload well under this, so anything larger is abusive.
app.use(express.json({ limit: '10kb' }));

// ── Health check (Railway uses this to confirm the process is up) ───────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Rate limiting ──────────────────────────────────────────────────────────────

// 1) Per-IP limit (handles shared origins / proxies).
const ipLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте позже.' },
});

// 2) Per-session limit — an in-memory counter keyed by the client's session id
//    (X-Session-Id header, falling back to IP). Catches a single client hammering
//    the endpoint even across IPs. Window resets every minute.
const SESSION_WINDOW_MS = 60 * 1000;
const SESSION_MAX = 30;
const sessionHits = new Map();

function sessionLimiter(req, res, next) {
  const id = (req.get('X-Session-Id') || '').slice(0, 100) || req.ip;
  const now = Date.now();
  let rec = sessionHits.get(id);
  if (!rec || now - rec.windowStart > SESSION_WINDOW_MS) {
    rec = { count: 0, windowStart: now };
  }
  rec.count += 1;
  sessionHits.set(id, rec);
  if (rec.count > SESSION_MAX) {
    return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
  }
  return next();
}

// Periodically prune expired session records so the Map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [id, rec] of sessionHits) {
    if (now - rec.windowStart > SESSION_WINDOW_MS) sessionHits.delete(id);
  }
}, 5 * 60 * 1000).unref();

// ── AI endpoint ──────────────────────────────────────────────────────────────
app.post('/api/ai', ipLimiter, sessionLimiter, async (req, res) => {
  // The API key never leaves the server. If it is missing, the AI is unconfigured.
  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: 'AI сервис не настроен' });
  }

  // Defence-in-depth size check (body-parser already caps at 10KB).
  try {
    if (JSON.stringify(req.body || {}).length > 10240) {
      return res.status(413).json({ error: 'Payload too large' });
    }
  } catch (_) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const { feature, payload } = req.body || {};

  try {
    const result = await handleFeature(feature, payload);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[/api/ai] error:', scrubSecrets(err?.message || err));
    return res.status(503).json({ error: 'AI сервис временно недоступен' });
  }
});

// ── Error handler ────────────────────────────────────────────────────────────
// Converts body-parser / CORS errors into clean JSON (and scrubs secrets).
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large' });
  }
  if (/Not allowed by CORS/.test(err?.message || '')) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  console.error('[server] error:', scrubSecrets(err?.message || err));
  return res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`AI backend listening on http://localhost:${PORT}`);
});
