import 'dotenv/config';
import crypto from 'node:crypto';

function parseOrigin(value, production) {
  const normalized = value.trim().replace(/\/$/, '');
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`Invalid allowed origin: ${value}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username || url.password
    || url.origin !== normalized
    || (production && url.protocol !== 'https:')) {
    throw new Error(`Invalid allowed origin: ${value}`);
  }
  return url.origin;
}

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000) {
    throw new Error(`${name} must be an integer between 1 and 100000`);
  }
  return parsed;
}

function booleanValue(value, fallback, name) {
  const normalized = value ?? String(fallback);
  if (!['true', 'false'].includes(normalized)) {
    throw new Error(`${name} must be "true" or "false"`);
  }
  return normalized === 'true';
}

export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const appMode = env.APP_MODE || 'license';
  const allowedOrigins = (env.ALLOWED_ORIGINS || env.PRODUCTION_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => parseOrigin(value, production));

  if (!['license', 'open'].includes(appMode)) throw new Error('APP_MODE must be "license" or "open"');
  if (production && appMode === 'open') throw new Error('APP_MODE=open is not allowed in production');

  if (production) {
    const missing = ['JWT_SECRET', 'OPENAI_API_KEY', 'DATABASE_URL']
      .filter((name) => !env[name]);
    if (!allowedOrigins.length) missing.push('ALLOWED_ORIGINS');
    const telegramConfigured = Boolean(
      env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_WEBHOOK_URL || env.TELEGRAM_WEBHOOK_SECRET,
    );
    if (telegramConfigured) {
      for (const name of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_URL', 'TELEGRAM_WEBHOOK_SECRET']) {
        if (!env[name]) missing.push(name);
      }
    }
    if (missing.length) {
      throw new Error(`Missing production configuration: ${[...new Set(missing)].join(', ')}`);
    }
    if (Buffer.byteLength(env.JWT_SECRET, 'utf8') < 32) {
      throw new Error('JWT_SECRET must be at least 32 bytes in production');
    }
    if (!/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL)) {
      throw new Error('DATABASE_URL must be a PostgreSQL URL');
    }
    if (env.TELEGRAM_WEBHOOK_URL) {
      let webhookUrl;
      try { webhookUrl = new URL(env.TELEGRAM_WEBHOOK_URL); } catch { /* checked below */ }
      if (webhookUrl?.protocol !== 'https:' || webhookUrl.search || webhookUrl.hash) {
        throw new Error('TELEGRAM_WEBHOOK_URL must be an HTTPS URL without query or fragment');
      }
    }
  }

  if (env.TELEGRAM_WEBHOOK_SECRET
    && !/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET)) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET must contain 32-256 letters, digits, underscores or hyphens');
  }
  if (env.MT_PUSH_TOKEN && Buffer.byteLength(env.MT_PUSH_TOKEN, 'utf8') < 32) {
    throw new Error('MT_PUSH_TOKEN must be at least 32 bytes');
  }

  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return {
    production,
    appMode,
    port,
    jwtSecret: env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
    allowedOrigins,
    betaBrokers: env.ENABLE_BETA_BROKERS === 'true',
    openaiConfigured: Boolean(env.OPENAI_API_KEY),
    telegramWebhookSecret: env.TELEGRAM_WEBHOOK_SECRET || '',
    aiDailyLimitLicense: positiveInteger(env.AI_DAILY_LIMIT_LICENSE, 200, 'AI_DAILY_LIMIT_LICENSE'),
    aiDailyLimitTrial: positiveInteger(env.AI_DAILY_LIMIT_TRIAL, 20, 'AI_DAILY_LIMIT_TRIAL'),
    databaseTlsRejectUnauthorized: booleanValue(
      env.DATABASE_TLS_REJECT_UNAUTHORIZED,
      true,
      'DATABASE_TLS_REJECT_UNAUTHORIZED',
    ),
    databaseConnectionTimeoutMs: positiveInteger(
      env.DATABASE_CONNECTION_TIMEOUT_MS,
      5_000,
      'DATABASE_CONNECTION_TIMEOUT_MS',
    ),
    databaseQueryTimeoutMs: positiveInteger(
      env.DATABASE_QUERY_TIMEOUT_MS,
      10_000,
      'DATABASE_QUERY_TIMEOUT_MS',
    ),
    databaseIdleTimeoutMs: positiveInteger(
      env.DATABASE_IDLE_TIMEOUT_MS,
      30_000,
      'DATABASE_IDLE_TIMEOUT_MS',
    ),
  };
}

export const config = Object.freeze(readConfig());
