import 'dotenv/config';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { AccessStore } from './src-server/accessStore.js';
import { createAuth } from './src-server/auth.js';
import { config } from './src-server/config.js';
import { handleFeature } from './src-server/router.js';
import {
  getOpenAIProviderStatus,
  probeOpenAIProvider,
} from './src-server/openaiClient.js';
import {
  getBotUsername,
  isTelegramConfigured,
  sendMessage,
  setWebhook,
} from './src-server/telegramBot.js';
import { fetchBinanceTrades } from './src-server/brokers/binance.js';
import { fetchBybitTrades } from './src-server/brokers/bybit.js';
import { createMtToken, readMtToken } from './src-server/mtToken.js';

export const app = express();
export const accessStore = new AccessStore({
  databaseTlsRejectUnauthorized: config.databaseTlsRejectUnauthorized,
  connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
  queryTimeoutMillis: config.databaseQueryTimeoutMs,
  idleTimeoutMillis: config.databaseIdleTimeoutMs,
});
export const storeReady = accessStore.init();
export const openAIStartupProbe = config.production && config.openaiConfigured
  ? probeOpenAIProvider()
  : Promise.resolve(getOpenAIProviderStatus());

const auth = createAuth({
  store: accessStore,
  secret: config.jwtSecret,
  appMode: config.appMode,
});

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value);
const AI_FEATURES = new Set([
  'parseJournal',
  'generateSummary',
  'answerQuestion',
  'explainWeaknesses',
]);

function scrubSecrets(input) {
  let text = String(input ?? '');
  for (const secret of [
    process.env.OPENAI_API_KEY,
    process.env.JWT_SECRET,
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.MT_PUSH_TOKEN,
    process.env.DATABASE_URL,
  ]) {
    if (secret) text = text.split(secret).join('[REDACTED]');
  }
  return text
    .replace(/\b[0-9a-f]{32}\b/gi, '[REDACTED-KEY]')
    .replace(/\b(?:sk-|sk_|gsk_)[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function validDeviceId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

function betaOnly(_req, res, next) {
  if (!config.betaBrokers) return res.status(404).json({ error: 'Integration is not available' });
  return next();
}

function accountId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(value)
    ? value
    : null;
}

function normalizeMtTrades(value) {
  if (!Array.isArray(value) || value.length > 10_000) return null;
  const trades = [];
  for (const item of value) {
    if (!isPlainObject(item)) return null;
    const pnl = Number(item.pnl);
    if (!Number.isFinite(pnl)) continue;
    trades.push({
      date: typeof item.date === 'string' ? item.date.slice(0, 64) : null,
      pnl,
      r: null,
      direction: item.direction === 'long' || item.direction === 'short' ? item.direction : null,
      symbol: typeof item.symbol === 'string' ? item.symbol.slice(0, 40) : null,
    });
  }
  return trades;
}

function telegramCode() {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let code = '';
  for (const byte of crypto.randomBytes(8)) code += alphabet[byte % alphabet.length];
  return code;
}

async function handleTelegramMessage(message) {
  const chatId = message?.chat?.id;
  const text = typeof message?.text === 'string' ? message.text.trim().slice(0, 4_096) : '';
  if (!Number.isSafeInteger(chatId)) return;

  if (text.startsWith('/start ')) {
    const code = text.slice(7).trim().toUpperCase();
    const validCode = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(code);
    const owner = validCode ? await accessStore.consumeTelegramCode(code, chatId) : null;
    await sendMessage(chatId, owner
      ? '✅ <b>Account connected.</b>\n\nRisk notifications are now enabled.'
      : '❌ This code is invalid or expired. Generate a new code in the app.');
  } else if (text === '/stop') {
    await accessStore.unlinkTelegramChat(chatId);
    await sendMessage(chatId, '🔕 Notifications disabled.');
  } else if (text === '/start' || text === '/help') {
    await sendMessage(chatId, 'Open Strategy Architect Pro, choose Connect Telegram, then send /start CODE.');
  }
}

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  const requestId = req.get('x-request-id')?.slice(0, 80) || crypto.randomUUID();
  req.requestId = requestId;
  res.set({
    'X-Request-Id': requestId,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': 'no-store',
  });
  if (config.production) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const normalized = origin.replace(/\/$/, '');
    if (!config.production && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) {
      return callback(null, true);
    }
    return callback(
      config.allowedOrigins.includes(normalized) ? null : new Error('Not allowed by CORS'),
      config.allowedOrigins.includes(normalized),
    );
  },
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  maxAge: 600,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

const globalJson = express.json({ limit: '24kb', strict: true });
app.use((req, res, next) => {
  if (req.path === '/api/broker/mt/push') return next();
  return globalJson(req, res, next);
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/ready', async (_req, res) => {
  try {
    await storeReady;
    await openAIStartupProbe;
    const aiState = getOpenAIProviderStatus().state;
    const invalidAiConfiguration = [
      'missing',
      'invalid_configuration',
      'invalid_credentials',
      'invalid_model',
    ].includes(aiState);
    if (!config.openaiConfigured || invalidAiConfiguration || !(await accessStore.ping())) {
      return res.status(503).json({ status: 'not_ready' });
    }
    return res.json({ status: 'ready', storage: accessStore.pool ? 'postgres' : 'file' });
  } catch {
    return res.status(503).json({ status: 'not_ready' });
  }
});

app.use(asyncRoute(async (_req, _res, next) => {
  await storeReady;
  next();
}));

const licenseLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a minute.' },
});

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
});

const requireAccess = auth.requireAccess();
const requireLicense = auth.requireAccess({ licenseOnly: true });

app.get('/api/auth-mode', (_req, res) => {
  res.json({
    mode: config.appMode,
    trial: { enabled: config.appMode === 'license', runs: 1, durationMinutes: 120 },
  });
});
app.get('/api/session', asyncRoute(auth.session));
app.post('/api/trial/start', licenseLimiter, asyncRoute(auth.startTrial));
app.post('/api/trial/complete', requireAccess, asyncRoute(auth.completeTrial));
app.post('/api/verify-license', licenseLimiter, asyncRoute(auth.verifyLicense));

app.post('/api/ai', requireAccess, apiLimiter, asyncRoute(async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'AI service is not configured' });
  }
  if (!isPlainObject(req.body)
    || typeof req.body.feature !== 'string'
    || !isPlainObject(req.body.payload)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  if (!AI_FEATURES.has(req.body.feature)) {
    return res.status(400).json({ error: 'Unknown feature' });
  }
  const dailyLimit = req.tokenPayload.type === 'trial'
    ? config.aiDailyLimitTrial
    : config.aiDailyLimitLicense;
  if (!(await accessStore.consumeAiQuota(req.tokenPayload.sub, dailyLimit))) {
    return res.status(429).json({
      error: 'Daily AI limit reached',
      code: 'AI_DAILY_LIMIT',
    });
  }
  const result = await handleFeature(req.body.feature, req.body.payload, {
    subject: req.tokenPayload.sub,
  });
  return res.status(result.status).json(result.body);
}));

app.get('/api/integrations', asyncRoute(async (_req, res) => {
  let botUsername = null;
  if (isTelegramConfigured()) {
    try { botUsername = await getBotUsername(); } catch { /* optional integration */ }
  }
  res.json({
    telegram: { enabled: isTelegramConfigured(), botUsername },
    brokers: {
      binance: config.betaBrokers,
      bybit: config.betaBrokers,
      metatrader: config.betaBrokers && Boolean(process.env.MT_PUSH_TOKEN),
      ctrader: false,
    },
  });
}));

app.post('/api/telegram/generate-code', requireLicense, apiLimiter, asyncRoute(async (req, res) => {
  const code = telegramCode();
  await accessStore.createTelegramCode(
    req.tokenPayload.sub,
    code,
    new Date(Date.now() + 10 * 60_000),
  );
  res.json({ code });
}));

app.post('/api/telegram/status', requireLicense, asyncRoute(async (req, res) => {
  res.json({ linked: (await accessStore.getTelegramChat(req.tokenPayload.sub)) !== null });
}));

app.post('/api/telegram/unlink', requireLicense, asyncRoute(async (req, res) => {
  await accessStore.unlinkTelegramOwner(req.tokenPayload.sub);
  res.json({ ok: true });
}));

app.post('/api/telegram/test', requireLicense, apiLimiter, asyncRoute(async (req, res) => {
  const chatId = await accessStore.getTelegramChat(req.tokenPayload.sub);
  if (chatId === null) return res.status(404).json({ error: 'Not linked' });
  await sendMessage(chatId, '✅ <b>Strategy Architect Pro</b>\n\nTelegram notifications are connected.');
  return res.json({ ok: true });
}));

app.post('/api/telegram/notify', requireLicense, apiLimiter, asyncRoute(async (req, res) => {
  const chatId = await accessStore.getTelegramChat(req.tokenPayload.sub);
  if (chatId === null) return res.json({ ok: false, reason: 'not_linked' });
  const { alertType, metrics } = req.body || {};
  if (!isPlainObject(metrics)) return res.status(400).json({ error: 'Invalid metrics' });
  const num = (value, digits = 2) => Number.isFinite(Number(value))
    ? Number(value).toFixed(digits)
    : '—';

  if (alertType === 'degradation') {
    await sendMessage(chatId,
      '⚠️ <b>Strategy degradation</b>\n\n'
      + `Earlier expectancy: <b>${num(metrics.earlyExpectancy)}</b>\n`
      + `Recent expectancy: <b>${num(metrics.recentExpectancy)}</b>\n\n`
      + 'Pause and review the strategy before the next session.');
  } else if (alertType === 'analysis_complete') {
    await sendMessage(chatId,
      '📊 <b>Analysis complete</b>\n\n'
      + `Score: <b>${num(metrics.score, 0)}/100</b>\n`
      + `Expectancy: <b>${num(metrics.expectancy)}</b>\n`
      + `Profit factor: <b>${num(metrics.profitFactor)}</b>`);
  } else {
    return res.status(400).json({ error: 'Unknown alert type' });
  }
  return res.json({ ok: true });
}));

app.post('/api/telegram/webhook', asyncRoute(async (req, res) => {
  if (!config.telegramWebhookSecret
    || !safeEqual(req.get('x-telegram-bot-api-secret-token'), config.telegramWebhookSecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.sendStatus(200);
  void handleTelegramMessage(req.body?.message).catch((error) => {
    console.error('[telegram webhook]', scrubSecrets(error?.message || error));
  });
}));

app.post('/api/broker/binance/trades', betaOnly, requireLicense, apiLimiter, asyncRoute(async (req, res) => {
  const { apiKey, apiSecret, accountType = 'futures', daysBack = 90 } = req.body || {};
  if (typeof apiKey !== 'string' || apiKey.length > 256
    || typeof apiSecret !== 'string' || apiSecret.length > 256
    || !['futures'].includes(accountType)
    || !Number.isInteger(Number(daysBack)) || Number(daysBack) < 1 || Number(daysBack) > 90) {
    return res.status(400).json({ error: 'Invalid broker credentials or range' });
  }
  return res.json(await fetchBinanceTrades({
    apiKey,
    apiSecret,
    accountType,
    daysBack: Number(daysBack),
  }));
}));

app.post('/api/broker/bybit/trades', betaOnly, requireLicense, apiLimiter, asyncRoute(async (req, res) => {
  const { apiKey, apiSecret, daysBack = 90 } = req.body || {};
  if (typeof apiKey !== 'string' || apiKey.length > 256
    || typeof apiSecret !== 'string' || apiSecret.length > 256
    || !Number.isInteger(Number(daysBack)) || Number(daysBack) < 1 || Number(daysBack) > 90) {
    return res.status(400).json({ error: 'Invalid broker credentials or range' });
  }
  return res.json(await fetchBybitTrades({ apiKey, apiSecret, daysBack: Number(daysBack) }));
}));

app.post(
  '/api/broker/mt/push',
  betaOnly,
  express.json({ limit: '2mb', strict: true }),
  asyncRoute(async (req, res) => {
    const mtAuth = readMtToken(req.get('x-mt-token'), { secret: process.env.MT_PUSH_TOKEN });
    if (!mtAuth || !(await accessStore.isLicenseActive(mtAuth.keyHash))) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const id = accountId(req.body?.accountId);
    const trades = normalizeMtTrades(req.body?.trades);
    if (!id || !trades) return res.status(400).json({ error: 'Invalid payload' });
    await accessStore.storeMtSnapshot(mtAuth.ownerId, id, trades);
    return res.json({ ok: true, received: trades.length });
  }),
);

app.get('/api/broker/mt/ea', betaOnly, requireLicense, asyncRoute(async (_req, res) => {
  const ea = await readFile(new URL('./src-server/brokers/mt_ea_template.mq5', import.meta.url), 'utf8');
  res.set({
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': 'attachment; filename="SAP_HistoryExporter.mq5"',
  });
  res.send(ea);
}));

app.get('/api/broker/mt/info', betaOnly, requireLicense, (req, res) => {
  if (!process.env.MT_PUSH_TOKEN) return res.status(503).json({ error: 'MetaTrader is not configured' });
  const token = createMtToken({
    ownerId: req.tokenPayload.sub,
    keyHash: req.tokenPayload.kh,
    secret: process.env.MT_PUSH_TOKEN,
  });
  return res.json({
    pushUrl: `${req.protocol}://${req.get('host')}/api/broker/mt/push`,
    token,
    configured: true,
  });
});

app.post('/api/broker/mt/fetch', betaOnly, requireLicense, asyncRoute(async (req, res) => {
  const id = accountId(req.body?.accountId);
  if (!id) return res.status(400).json({ error: 'Invalid account id' });
  const snapshot = await accessStore.getMtSnapshot(req.tokenPayload.sub, id);
  if (!snapshot) return res.status(404).json({ error: 'No data for this account' });
  return res.json({
    error: null,
    trades: snapshot.trades,
    source: 'MetaTrader beta',
    count: snapshot.trades.length,
    updatedAt: snapshot.updatedAt,
    completeness: 'partial',
  });
}));

app.all(/^\/api\/broker\/ctrader(?:\/|$)/, requireLicense, (_req, res) => {
  res.status(503).json({ error: 'cTrader is disabled until the official protocol integration is complete' });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large' });
  }
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  if (/Not allowed by CORS/.test(error?.message || '')) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  console.error('[server]', scrubSecrets(error?.message || error));
  return res.status(500).json({ error: 'Internal server error' });
});

export async function startServer(port = config.port) {
  await storeReady;
  const server = app.listen(port, () => {
    console.log(`Strategy Architect API listening on port ${server.address().port}`);
  });

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_URL) {
    setWebhook(
      `${process.env.TELEGRAM_WEBHOOK_URL.replace(/\/$/, '')}/api/telegram/webhook`,
      config.telegramWebhookSecret,
    ).catch((error) => console.error('[telegram webhook]', scrubSecrets(error?.message || error)));
  }

  const shutdown = async () => {
    server.close(async () => {
      await accessStore.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

const entrypoint = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (entrypoint) {
  startServer().catch((error) => {
    console.error('[startup]', scrubSecrets(error?.message || error));
    process.exit(1);
  });
}
