import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { generateLicenseKey, hashLicenseKey } from '../src-server/licenseKeys.js';
import { TRIAL_DURATION_MS } from '../src-server/accessStore.js';

const ENV_KEYS = [
  'NODE_ENV',
  'APP_MODE',
  'JWT_SECRET',
  'OPENAI_API_KEY',
  'DATABASE_URL',
  'DATABASE_TLS_REJECT_UNAUTHORIZED',
  'DATABASE_CONNECTION_TIMEOUT_MS',
  'DATABASE_QUERY_TIMEOUT_MS',
  'DATABASE_IDLE_TIMEOUT_MS',
  'ACCESS_STORE_PATH',
  'ALLOWED_ORIGINS',
  'ENABLE_BETA_BROKERS',
  'LICENSE_KEY_HASHES',
  'LICENSE_KEYS',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_URL',
  'TELEGRAM_WEBHOOK_SECRET',
  'MT_PUSH_TOKEN',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const licenseKey = generateLicenseKey();
const webhookSecret = 'webhook_secret_12345678901234567';

let runtime;

function setTestEnv({ betaBrokers }) {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_MODE: 'license',
    JWT_SECRET: 'integration-test-jwt-secret-1234567890',
    OPENAI_API_KEY: 'test-openai-key',
    DATABASE_URL: '',
    DATABASE_TLS_REJECT_UNAUTHORIZED: 'true',
    DATABASE_CONNECTION_TIMEOUT_MS: '5000',
    DATABASE_QUERY_TIMEOUT_MS: '10000',
    DATABASE_IDLE_TIMEOUT_MS: '30000',
    ALLOWED_ORIGINS: 'https://app.example.test',
    ENABLE_BETA_BROKERS: betaBrokers ? 'true' : 'false',
    LICENSE_KEY_HASHES: JSON.stringify([hashLicenseKey(licenseKey)]),
    LICENSE_KEYS: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_WEBHOOK_URL: '',
    TELEGRAM_WEBHOOK_SECRET: webhookSecret,
    MT_PUSH_TOKEN: '',
  });
}

async function boot(options) {
  setTestEnv(options);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sap-http-'));
  process.env.ACCESS_STORE_PATH = path.join(dir, 'access.json');
  vi.resetModules();
  const module = await import('../server.js');
  await module.storeReady;
  const server = await new Promise((resolve) => {
    const listening = module.app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  return {
    module,
    server,
    dir,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

async function stop(current) {
  if (!current) return;
  await new Promise((resolve, reject) => current.server.close((error) => {
    if (error) reject(error);
    else resolve();
  }));
  await current.module.accessStore.close();
  await rm(current.dir, { recursive: true, force: true });
}

async function request(pathname, {
  method = 'GET',
  token,
  origin,
  body,
  headers = {},
} = {}) {
  const response = await fetch(`${runtime.baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { response, data };
}

async function activateLicense() {
  const result = await request('/api/verify-license', {
    method: 'POST',
    headers: { 'X-Forwarded-For': '198.51.100.10' },
    body: { key: licenseKey, deviceId: 'http-test-device-licensed', rememberMe: false },
  });
  expect(result.response.status).toBe(200);
  return result.data.token;
}

describe.sequential('server HTTP boundaries', () => {
  beforeAll(async () => {
    runtime = await boot({ betaBrokers: true });
  });

  afterAll(async () => {
    await stop(runtime);
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('reports license mode and rejects protected calls without a token', async () => {
    const mode = await request('/api/auth-mode');
    expect(mode.response.status).toBe(200);
    expect(mode.data).toMatchObject({
      mode: 'license',
      trial: { enabled: true, runs: 1, durationMinutes: 120 },
    });

    const protectedCall = await request('/api/telegram/status', { method: 'POST', body: {} });
    expect(protectedCall.response.status).toBe(401);
  });

  it('reports live storage readiness and returns 503 when its ping fails', async () => {
    const ready = await request('/ready');
    expect(ready.response.status).toBe(200);
    expect(ready.data).toEqual({ status: 'ready', storage: 'file' });

    const ping = vi.spyOn(runtime.module.accessStore, 'ping').mockResolvedValue(false);
    try {
      const unavailable = await request('/ready');
      expect(unavailable.response.status).toBe(503);
      expect(unavailable.data).toEqual({ status: 'not_ready' });
    } finally {
      ping.mockRestore();
    }
  });

  it('binds a license device slot to a signed HttpOnly grant instead of a client id', async () => {
    const first = await request('/api/verify-license', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '198.51.100.20' },
      body: { key: licenseKey, rememberMe: false },
    });
    expect(first.response.status).toBe(200);
    const cookie = first.response.headers.get('set-cookie');
    expect(cookie).toMatch(/^sap_license_device=.*HttpOnly.*SameSite=Lax/i);

    const second = await request('/api/verify-license', {
      method: 'POST',
      headers: {
        Cookie: cookie.split(';')[0],
        'X-Forwarded-For': '198.51.100.21',
      },
      body: {
        key: licenseKey,
        deviceId: 'untrusted-and-changed-client-id',
        rememberMe: false,
      },
    });
    expect(second.response.status).toBe(200);
    expect(runtime.module.accessStore.file.devices[hashLicenseKey(licenseKey)]).toHaveLength(1);
  });

  it('allows one trial lifecycle while keeping the issued session valid', async () => {
    const deviceId = 'http-test-trial-device';
    const started = await request('/api/trial/start', {
      method: 'POST',
      body: { deviceId },
    });
    expect(started.response.status).toBe(200);
    expect(started.data.access).toBe('trial');
    const cookie = started.response.headers.get('set-cookie');
    expect(cookie).toMatch(/^sap_trial_device=.*HttpOnly.*SameSite=Lax/i);

    const resumed = await request('/api/trial/start', {
      method: 'POST',
      headers: { Cookie: cookie.split(';')[0] },
      body: { deviceId: 'changed-client-device-id' },
    });
    expect(resumed.response.status).toBe(200);
    expect(jwt.decode(resumed.data.token)).toMatchObject({
      trialId: jwt.decode(started.data.token).trialId,
      exp: jwt.decode(started.data.token).exp,
    });

    const session = await request('/api/session', { token: started.data.token });
    expect(session.data).toMatchObject({
      authenticated: true,
      access: 'trial',
      trialActive: true,
    });
    const lowercaseScheme = await request('/api/session', {
      headers: { Authorization: `bearer ${started.data.token}` },
    });
    expect(lowercaseScheme.data.authenticated).toBe(true);

    const completed = await request('/api/trial/complete', {
      method: 'POST',
      token: started.data.token,
      body: {},
    });
    expect(completed.data).toEqual({ ok: true });

    const currentSession = await request('/api/session', { token: started.data.token });
    expect(currentSession.data.authenticated).toBe(true);

    const restarted = await request('/api/trial/start', {
      method: 'POST',
      body: { deviceId },
    });
    expect(restarted.response.status).toBe(403);
    expect(restarted.data.code).toBe('TRIAL_USED');
  });

  it('rejects an expired trial without creating a fresh two-hour session', async () => {
    const deviceId = 'http-test-expired-device';
    const started = await request('/api/trial/start', {
      method: 'POST',
      body: { deviceId },
    });
    const payload = jwt.decode(started.data.token);
    runtime.module.accessStore.file.trials[payload.fp].startedAt =
      new Date(Date.now() - TRIAL_DURATION_MS).toISOString();

    const session = await request('/api/session', { token: started.data.token });
    expect(session.data.authenticated).toBe(false);

    const restarted = await request('/api/trial/start', {
      method: 'POST',
      body: { deviceId },
    });
    expect(restarted.response.status).toBe(403);
    expect(restarted.data.code).toBe('TRIAL_USED');
    expect(runtime.module.accessStore.file.trials[payload.fp].status).toBe('expired');
  });

  it('uses a privacy-preserving proxy IP and browser-family abuse bucket', async () => {
    const first = await request('/api/trial/start', {
      method: 'POST',
      headers: {
        'X-Forwarded-For': '203.0.113.42',
        'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36',
      },
      body: { deviceId: 'network-bucket-device-one' },
    });
    const second = await request('/api/trial/start', {
      method: 'POST',
      headers: {
        'X-Forwarded-For': '203.0.113.42',
        'User-Agent': 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
      },
      body: { deviceId: 'network-bucket-device-two' },
    });
    const neighbor = await request('/api/trial/start', {
      method: 'POST',
      headers: {
        'X-Forwarded-For': '203.0.113.43',
        'User-Agent': 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
      },
      body: { deviceId: 'network-bucket-device-three' },
    });
    const firstPayload = jwt.decode(first.data.token);
    const secondPayload = jwt.decode(second.data.token);
    const neighborPayload = jwt.decode(neighbor.data.token);
    const firstBucket = runtime.module.accessStore.file.trials[firstPayload.fp].abuseBucket;
    const secondBucket = runtime.module.accessStore.file.trials[secondPayload.fp].abuseBucket;
    const neighborBucket = runtime.module.accessStore.file.trials[neighborPayload.fp].abuseBucket;

    expect(firstBucket).toMatch(/^[a-f0-9]{64}$/);
    expect(secondBucket).toBe(firstBucket);
    expect(neighborBucket).not.toBe(firstBucket);
    expect(JSON.stringify(runtime.module.accessStore.file)).not.toContain('203.0.113.');
    expect(JSON.stringify(runtime.module.accessStore.file)).not.toContain('Chrome/');
  });

  it('returns 400 for a hostile broker body and keeps serving requests', async () => {
    const token = await activateLicense();
    const malformed = await request('/api/broker/binance/trades', {
      method: 'POST',
      token,
      body: {
        apiKey: 'key',
        apiSecret: { valueOf: 'not callable' },
        accountType: 'futures',
        daysBack: 30,
      },
    });
    expect(malformed.response.status).toBe(400);

    const health = await request('/health');
    expect(health.response.status).toBe(200);
    expect(health.data).toEqual({ status: 'ok' });
  });

  it('enforces the Telegram webhook secret', async () => {
    const denied = await request('/api/telegram/webhook', {
      method: 'POST',
      body: {},
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret' },
    });
    expect(denied.response.status).toBe(401);

    const accepted = await request('/api/telegram/webhook', {
      method: 'POST',
      body: {},
      headers: { 'X-Telegram-Bot-Api-Secret-Token': webhookSecret },
    });
    expect(accepted.response.status).toBe(200);
  });

  it('rejects an untrusted browser origin', async () => {
    const result = await request('/api/auth-mode', { origin: 'https://evil.example.test' });
    expect(result.response.status).toBe(403);
    expect(result.data).toEqual({ error: 'Origin not allowed' });
  });

  it('does not expose beta broker routes when the flag is disabled', async () => {
    await stop(runtime);
    runtime = await boot({ betaBrokers: false });
    const result = await request('/api/broker/bybit/trades', {
      method: 'POST',
      body: { apiKey: 'key', apiSecret: 'secret', daysBack: 30 },
    });
    expect(result.response.status).toBe(404);
  });
});
