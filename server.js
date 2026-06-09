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

// CORS allow-list (checked in order):
//   1. No Origin header  → server-to-server / Vercel proxy rewrite / curl — always OK.
//   2. localhost:5173    → local Vite dev server.
//   3. *.vercel.app      → every Vercel deployment (production + all preview branches).
//   4. PRODUCTION_ORIGIN → explicit custom domain, if configured.
//   5. Fallback          → if PRODUCTION_ORIGIN is not set, allow all but log a warning
//                          so the first deploy works before the domain is known.
app.use(
  cors({
    origin(origin, callback) {
      // 1. No Origin header (server-to-server, Vercel rewrite proxy, curl, etc.)
      if (!origin) return callback(null, true);

      // 2. Local dev.
      if (origin === 'http://localhost:5173') return callback(null, true);

      // 3. Any Vercel deployment — production URL and every preview branch URL.
      //    Pattern: https://<anything>.vercel.app
      if (origin.endsWith('.vercel.app')) return callback(null, true);

      // 4. Explicit custom domain (e.g. https://strategy-architect-pro.com).
      if (process.env.PRODUCTION_ORIGIN && origin === process.env.PRODUCTION_ORIGIN) {
        return callback(null, true);
      }

      // 5. No PRODUCTION_ORIGIN set — allow all as a temporary fallback.
      if (!process.env.PRODUCTION_ORIGIN) {
        console.warn(`[CORS] No PRODUCTION_ORIGIN set — allowing origin: ${origin}`);
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'));
    },
  })
);

app.use(express.json({ limit: '1mb' }));

// ── Health check (Railway uses this to confirm the process is up) ───────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── AI endpoint ──────────────────────────────────────────────────────────────

// Rate limit: 20 requests per minute per IP.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте позже.' },
});

app.post('/api/ai', aiLimiter, async (req, res) => {
  // The API key never leaves the server. If it is missing, the AI is unconfigured.
  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: 'AI сервис не настроен' });
  }

  const { feature, payload } = req.body || {};

  try {
    const result = await handleFeature(feature, payload);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[/api/ai] error:', err);
    return res.status(503).json({ error: 'AI сервис временно недоступен' });
  }
});

app.listen(PORT, () => {
  console.log(`AI backend listening on http://localhost:${PORT}`);
});
