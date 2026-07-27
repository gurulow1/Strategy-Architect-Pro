import { describe, expect, it } from 'vitest';
import { readConfig } from '../src-server/config.js';

const productionEnv = {
  NODE_ENV: 'production',
  APP_MODE: 'license',
  JWT_SECRET: 'j'.repeat(64),
  OPENAI_API_KEY: 'test-openai-key',
  DATABASE_URL: 'postgresql://user:pass@db.example.test:5432/app',
  ALLOWED_ORIGINS: 'https://app.example.test',
};

describe('production config', () => {
  it('accepts a complete HTTPS production configuration', () => {
    const result = readConfig(productionEnv);
    expect(result.production).toBe(true);
    expect(result.allowedOrigins).toEqual(['https://app.example.test']);
    expect(result).toMatchObject({
      databaseTlsRejectUnauthorized: true,
      databaseConnectionTimeoutMs: 5_000,
      databaseQueryTimeoutMs: 10_000,
      databaseIdleTimeoutMs: 30_000,
    });
  });

  it('rejects weak secrets and insecure origins', () => {
    expect(() => readConfig({ ...productionEnv, JWT_SECRET: 'short' }))
      .toThrow(/JWT_SECRET/);
    expect(() => readConfig({ ...productionEnv, ALLOWED_ORIGINS: 'http://app.example.test' }))
      .toThrow(/allowed origin/i);
  });

  it('requires a complete secured Telegram webhook configuration', () => {
    expect(() => readConfig({ ...productionEnv, TELEGRAM_BOT_TOKEN: 'bot-token' }))
      .toThrow(/TELEGRAM_WEBHOOK_URL/);

    expect(() => readConfig({
      ...productionEnv,
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_WEBHOOK_URL: 'https://api.example.test',
      TELEGRAM_WEBHOOK_SECRET: 's'.repeat(40),
    })).not.toThrow();
  });

  it('rejects a weak MetaTrader signing secret', () => {
    expect(() => readConfig({ ...productionEnv, MT_PUSH_TOKEN: 'short' }))
      .toThrow(/MT_PUSH_TOKEN/);
  });

  it('validates configurable daily AI quotas', () => {
    expect(readConfig(productionEnv)).toMatchObject({
      aiDailyLimitLicense: 200,
      aiDailyLimitTrial: 20,
    });
    expect(() => readConfig({ ...productionEnv, AI_DAILY_LIMIT_TRIAL: '0' }))
      .toThrow(/AI_DAILY_LIMIT_TRIAL/);
  });

  it('requires PostgreSQL in production', () => {
    const { DATABASE_URL: _databaseUrl, ...withoutDatabase } = productionEnv;
    expect(() => readConfig(withoutDatabase)).toThrow(/DATABASE_URL/);
    expect(() => readConfig({ ...productionEnv, DATABASE_URL: 'mysql://db.example.test/app' }))
      .toThrow(/DATABASE_URL/);
  });

  it('supports an explicit TLS verification opt-out and validates DB timeouts', () => {
    expect(readConfig({
      ...productionEnv,
      DATABASE_TLS_REJECT_UNAUTHORIZED: 'false',
      DATABASE_CONNECTION_TIMEOUT_MS: '2500',
      DATABASE_QUERY_TIMEOUT_MS: '7500',
      DATABASE_IDLE_TIMEOUT_MS: '45000',
    })).toMatchObject({
      databaseTlsRejectUnauthorized: false,
      databaseConnectionTimeoutMs: 2_500,
      databaseQueryTimeoutMs: 7_500,
      databaseIdleTimeoutMs: 45_000,
    });

    expect(() => readConfig({
      ...productionEnv,
      DATABASE_TLS_REJECT_UNAUTHORIZED: '0',
    })).toThrow(/DATABASE_TLS_REJECT_UNAUTHORIZED/);
    expect(() => readConfig({
      ...productionEnv,
      DATABASE_QUERY_TIMEOUT_MS: '0',
    })).toThrow(/DATABASE_QUERY_TIMEOUT_MS/);
  });
});
