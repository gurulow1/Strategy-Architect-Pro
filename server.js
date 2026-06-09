import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
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
  // Scrub 32-char hex strings (license key shape) — must not appear in logs.
  out = out.replace(/\b[0-9a-f]{32}\b/gi, '[REDACTED-KEY]');
  return out
    .replace(/gsk_[A-Za-z0-9]+/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ── License-key rate limiter (stricter than general — 5 attempts / IP / min) ─
const licenseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a minute.' },
});

// ── Auth-mode probe (safe to call without credentials) ────────────────────────
app.get('/api/auth-mode', (_req, res) => {
  res.json({ mode: process.env.LICENSE_KEYS ? 'license' : 'open' });
});

// ── License-key verification ──────────────────────────────────────────────────
app.post('/api/verify-license', licenseLimiter, async (req, res) => {
  // No keys configured → open / demo mode. Issue a short-lived demo token.
  if (!process.env.LICENSE_KEYS) {
    const secret = process.env.JWT_SECRET || 'demo-open-mode';
    const token = jwt.sign({ type: 'open' }, secret, { expiresIn: '24h' });
    return res.json({ token });
  }

  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const rawKey = req.body?.key;
  // Validate format before any further processing — reject early without timing info.
  if (typeof rawKey !== 'string' || !/^[0-9a-f]{32}$/i.test(rawKey.trim())) {
    await delay(50 + Math.random() * 100);
    return res.status(401).json({ error: 'Invalid license key' });
  }
  const key = rawKey.trim().toLowerCase();

  let validKeys;
  try {
    const parsed = JSON.parse(process.env.LICENSE_KEYS);
    // Accept both ["key1","key2"] array and {"key1":"label"} object formats.
    validKeys = Array.isArray(parsed) ? parsed : Object.keys(parsed);
  } catch {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Timing-safe comparison — prevents timing oracle attacks.
  const keyBuf = Buffer.from(key, 'utf8');
  let matched = false;
  for (const candidate of validKeys) {
    if (typeof candidate !== 'string') continue;
    const norm = candidate.trim().toLowerCase();
    if (norm.length !== key.length) continue;
    const candidateBuf = Buffer.from(norm, 'utf8');
    if (crypto.timingSafeEqual(keyBuf, candidateBuf)) { matched = true; break; }
  }

  // Fixed-duration random delay makes success/failure timing indistinguishable.
  await delay(50 + Math.random() * 100);

  if (!matched) {
    return res.status(401).json({ error: 'Invalid license key' });
  }

  const rememberMe = req.body?.rememberMe !== false;
  const token = jwt.sign({ type: 'license' }, process.env.JWT_SECRET, {
    expiresIn: rememberMe ? '7d' : '24h',
  });
  return res.json({ token });
});

// ── JWT auth middleware — only enforced when LICENSE_KEYS is configured ───────
function requireAuth(req, res, next) {
  if (!process.env.LICENSE_KEYS || !process.env.JWT_SECRET) return next();
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.tokenPayload = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    return next();
  } catch (err) {
    const expired = err?.name === 'TokenExpiredError';
    return res.status(401).json({
      error: expired ? 'Token expired' : 'Unauthorized',
      ...(expired && { code: 'TOKEN_EXPIRED' }),
    });
  }
}

// ── AI endpoint ──────────────────────────────────────────────────────────────
app.post('/api/ai', ipLimiter, sessionLimiter, requireAuth, async (req, res) => {
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
