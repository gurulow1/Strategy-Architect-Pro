import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { handleFeature } from './src-server/router.js';

// Integrations: Telegram notifications + read-only broker history import.
import {
  isTelegramConfigured, sendMessage, getBotUsername, setWebhook,
} from './src-server/telegramBot.js';
import {
  createLinkCode, linkByCode, unlinkKey, getChatId, getChatIdMap,
} from './src-server/telegramStore.js';
import { fetchBinanceTrades } from './src-server/brokers/binance.js';
import { fetchBybitTrades } from './src-server/brokers/bybit.js';
import { storeMTData, getMTData } from './src-server/brokers/metatrader.js';
import {
  isCTraderConfigured, getAuthUrl, exchangeCode, fetchCTraderTrades,
} from './src-server/brokers/ctrader.js';

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
    // Any localhost / 127.0.0.1 port — Vite may pick 5173, 5180, etc. in dev.
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
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
// Exception: the MetaTrader EA push can legitimately carry 90 days of deals,
// so that one route gets its own larger parser (mounted on the route below).
const globalJson = express.json({ limit: '10kb' });
app.use((req, res, next) => {
  if (req.path === '/api/broker/mt/push') return next();
  return globalJson(req, res, next);
});

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

// ── Integrations probe (public) ───────────────────────────────────────────────
// Lets the frontend show/hide Telegram & broker panels without exposing secrets.
app.get('/api/integrations', async (_req, res) => {
  let botUsername = null;
  if (isTelegramConfigured()) {
    try { botUsername = await getBotUsername(); } catch (_) { /* ignore */ }
  }
  res.json({
    telegram: { enabled: isTelegramConfigured(), botUsername },
    brokers: {
      binance: true,
      bybit: true,
      metatrader: Boolean(process.env.MT_PUSH_TOKEN),
      ctrader: isCTraderConfigured(),
    },
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  Telegram notifications
// ════════════════════════════════════════════════════════════════════════════

// Generate a one-time link code (the client sends its own stable accountKey).
app.post('/api/telegram/generate-code', requireAuth, (req, res) => {
  const { licenseKey } = req.body || {};
  if (!licenseKey) return res.status(400).json({ error: 'Missing account key' });
  res.json({ code: createLinkCode(String(licenseKey)) });
});

app.post('/api/telegram/status', requireAuth, (req, res) => {
  const { licenseKey } = req.body || {};
  res.json({ linked: licenseKey ? getChatId(String(licenseKey)) !== null : false });
});

app.post('/api/telegram/unlink', requireAuth, (req, res) => {
  const { licenseKey } = req.body || {};
  if (licenseKey) unlinkKey(String(licenseKey));
  res.json({ ok: true });
});

app.post('/api/telegram/test', requireAuth, async (req, res) => {
  const { licenseKey } = req.body || {};
  const chatId = licenseKey ? getChatId(String(licenseKey)) : null;
  if (!chatId) return res.status(404).json({ error: 'Not linked' });
  await sendMessage(chatId, '✅ <b>Strategy Architect Pro</b>\n\nTelegram подключён! Теперь вы будете получать уведомления.');
  res.json({ ok: true });
});

// Fire a formatted alert (client calls this when report.alerts contains an item).
app.post('/api/telegram/notify', requireAuth, async (req, res) => {
  const { licenseKey, alertType, metrics } = req.body || {};
  const chatId = licenseKey ? getChatId(String(licenseKey)) : null;
  if (!chatId) return res.json({ ok: false, reason: 'not_linked' });

  const num = (v, d = 2) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '—');

  if (alertType === 'degradation') {
    await sendMessage(chatId,
      '⚠️ <b>Деградация стратегии</b>\n\n'
      + 'Последние сделки заметно слабее ранних:\n'
      + `• Раннее ожидание: <b>${num(metrics?.earlyExpectancy)}</b>\n`
      + `• Последнее ожидание: <b>${num(metrics?.recentExpectancy)}</b>\n\n`
      + 'Рекомендуется пауза и пересмотр параметров стратегии.');
  } else if (alertType === 'analysis_complete') {
    await sendMessage(chatId,
      '📊 <b>Анализ завершён</b>\n\n'
      + `Оценка: <b>${metrics?.score ?? '—'}/100</b>\n`
      + `Ожидание: <b>${num(metrics?.expectancy)}</b>\n`
      + `Profit Factor: <b>${num(metrics?.profitFactor)}</b>\n`
      + `Риск разорения: <b>${num((metrics?.riskOfRuin ?? 0) * 100, 1)}%</b>`);
  } else {
    return res.status(400).json({ ok: false, reason: 'unknown_alert' });
  }
  res.json({ ok: true });
});

// Telegram webhook — public (Telegram has no auth header). Reply fast, then act.
app.post('/api/telegram/webhook', async (req, res) => {
  res.sendStatus(200);
  const msg = req.body?.message;
  if (!msg) return;
  const text = (msg.text || '').trim();
  const chatId = msg.chat?.id;
  if (chatId == null) return;

  if (text.startsWith('/start ')) {
    const code = text.slice(7).trim();
    const key = linkByCode(code, chatId);
    await sendMessage(chatId, key
      ? '✅ <b>Аккаунт привязан!</b>\n\nВы будете получать:\n• Алёрты о деградации стратегии\n• Сводки по анализу\n\nКоманды:\n/report — отчёт по запросу\n/stop — отключить уведомления'
      : '❌ Код недействителен или истёк. Получите новый в приложении.');
    return;
  }
  if (text === '/report') {
    await sendMessage(chatId, '📊 Отчёт по запросу появится в следующей версии. Запустите анализ в приложении — уведомление придёт автоматически.');
    return;
  }
  if (text === '/stop') {
    for (const [key, cid] of getChatIdMap()) {
      if (cid === chatId) { unlinkKey(key); break; }
    }
    await sendMessage(chatId, '🔕 Уведомления отключены.');
    return;
  }
  if (text === '/start' || text === '/help') {
    await sendMessage(chatId, 'Откройте Strategy Architect Pro и нажмите «Подключить Telegram», затем отправьте сюда команду <code>/start КОД</code>.');
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  Broker history import (read-only; keys passed per request, never stored)
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/broker/binance/trades', ipLimiter, requireAuth, async (req, res) => {
  const { apiKey, apiSecret, accountType, daysBack } = req.body || {};
  const result = await fetchBinanceTrades({ apiKey, apiSecret, accountType, daysBack });
  res.json(result);
});

app.post('/api/broker/bybit/trades', ipLimiter, requireAuth, async (req, res) => {
  const { apiKey, apiSecret, daysBack } = req.body || {};
  const result = await fetchBybitTrades({ apiKey, apiSecret, daysBack });
  res.json(result);
});

// EA → server push. Uses its own 2MB parser and a shared secret (not JWT auth).
app.post('/api/broker/mt/push', express.json({ limit: '2mb' }), (req, res) => {
  const token = req.headers['x-mt-token'];
  if (!process.env.MT_PUSH_TOKEN || token !== process.env.MT_PUSH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { accountId, trades } = req.body || {};
  if (!accountId || !Array.isArray(trades)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  const received = storeMTData(accountId, trades);
  res.json({ ok: true, received });
});

// Download the MetaTrader Expert Advisor template (public — it's just a script).
app.get('/api/broker/mt/ea', (_req, res) => {
  try {
    const ea = readFileSync(new URL('./src-server/brokers/mt_ea_template.mq5', import.meta.url), 'utf8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="SAP_HistoryExporter.mq5"');
    res.send(ea);
  } catch (_) {
    res.status(404).json({ error: 'EA template not found' });
  }
});

// Frontend tells the user where the EA should push + the token to paste in.
app.get('/api/broker/mt/info', requireAuth, (req, res) => {
  res.json({
    pushUrl: `${req.protocol}://${req.get('host')}/api/broker/mt/push`,
    token: process.env.MT_PUSH_TOKEN || '',
    configured: Boolean(process.env.MT_PUSH_TOKEN),
  });
});

app.post('/api/broker/mt/fetch', requireAuth, (req, res) => {
  const { accountId } = req.body || {};
  const data = accountId ? getMTData(accountId) : null;
  if (!data) return res.status(404).json({ error: 'No data for this account. Install and run the EA.' });
  res.json({ error: null, trades: data.trades, source: data.source, count: data.trades.length, updatedAt: data.updatedAt });
});

// cTrader OAuth: build the consent URL (redirect URI is this server's callback).
app.get('/api/broker/ctrader/auth', requireAuth, (req, res) => {
  if (!isCTraderConfigured()) return res.status(503).json({ error: 'cTrader not configured' });
  const redirectUri = `${req.protocol}://${req.get('host')}/api/broker/ctrader/callback`;
  const state = crypto.randomBytes(8).toString('hex');
  res.json({ authUrl: getAuthUrl(redirectUri, state) });
});

// cTrader OAuth callback → exchange code, hand the token to the frontend via
// URL hash (never logged server-side) on the configured frontend origin.
app.get('/api/broker/ctrader/callback', async (req, res) => {
  const front = process.env.PRODUCTION_ORIGIN || '';
  const { code, error } = req.query;
  if (error || !code) return res.redirect(`${front}/#ctrader=error`);
  const redirectUri = `${req.protocol}://${req.get('host')}/api/broker/ctrader/callback`;
  const tokens = await exchangeCode(code, redirectUri);
  if (!tokens?.access_token) return res.redirect(`${front}/#ctrader=error`);
  res.redirect(`${front}/#ctrader_token=${encodeURIComponent(tokens.access_token)}`);
});

app.post('/api/broker/ctrader/trades', ipLimiter, requireAuth, async (req, res) => {
  const { accessToken, accountId, daysBack = 90 } = req.body || {};
  if (!accessToken || !accountId) return res.status(400).json({ error: 'Missing params' });
  const result = await fetchCTraderTrades(accessToken, accountId, daysBack);
  res.json(result);
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

  // Register the Telegram webhook once at startup, if configured.
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_URL) {
    setWebhook(`${process.env.TELEGRAM_WEBHOOK_URL}/api/telegram/webhook`)
      .then((r) => console.log(`[Telegram] Webhook ${r?.ok ? 'registered' : 'registration failed'}`))
      .catch(() => {});
  }
});
