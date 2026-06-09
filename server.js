import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { handleFeature } from './src-server/router.js';

const app  = express();
const PORT = process.env.PORT || 3001;

// CORS: always allow localhost:5173 (dev).
// In production, allow PRODUCTION_ORIGIN if set; allow all origins as a
// temporary fallback so the first deploy works before the domain is known.
app.use(
  cors({
    origin(origin, callback) {
      // Same-origin / non-browser requests (no Origin header) — always OK.
      if (!origin) return callback(null, true);
      // Local dev.
      if (origin === 'http://localhost:5173') return callback(null, true);
      // Production: restrict to configured origin, or allow all temporarily.
      if (!process.env.PRODUCTION_ORIGIN || origin === process.env.PRODUCTION_ORIGIN) {
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
