import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AccessStore } from '../src-server/accessStore.js';
import { generateLicenseKey, hashLicenseKey } from '../src-server/licenseKeys.js';

const stores = [];
const dirs = [];

afterEach(async () => {
  delete process.env.LICENSE_KEY_HASHES;
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

async function fileStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sap-access-'));
  dirs.push(dir);
  const store = new AccessStore({ databaseUrl: '', filePath: path.join(dir, 'access.json') });
  stores.push(store);
  await store.init();
  return store;
}

function postgresStore(options = {}) {
  const store = new AccessStore({
    databaseUrl: 'postgresql://user:database-secret@db.example.test:5432/app',
    ...options,
  });
  stores.push(store);
  return store;
}

describe('access store', () => {
  it('resumes only the original trial window and persists consumption', async () => {
    const store = await fileStore();
    const startedAt = new Date('2026-07-26T10:00:00Z');
    const trial = await store.startTrial('device-fingerprint', { now: startedAt });
    const resumed = await store.startTrial('device-fingerprint', {
      now: new Date('2026-07-26T11:30:00Z'),
    });
    expect(resumed).toEqual(trial);
    expect(await store.isTrialActive(
      'device-fingerprint',
      trial.trial_id,
      new Date('2026-07-26T11:59:59Z'),
    )).toBe(true);
    expect(await store.consumeTrial(
      'device-fingerprint',
      trial.trial_id,
      new Date('2026-07-26T11:45:00Z'),
    )).toBe(true);
    expect(await store.consumeTrial(
      'device-fingerprint',
      trial.trial_id,
      new Date('2026-07-26T11:46:00Z'),
    )).toBe(true);
    expect(await store.startTrial('device-fingerprint')).toBeNull();
  });

  it('expires a trial exactly two hours after its first start and never restarts it', async () => {
    const store = await fileStore();
    const startedAt = new Date('2026-07-26T10:00:00Z');
    const trial = await store.startTrial('expiring-device', { now: startedAt });
    const expiredAt = new Date('2026-07-26T12:00:00Z');

    expect(await store.isTrialActive('expiring-device', trial.trial_id, expiredAt)).toBe(false);
    expect(await store.startTrial('expiring-device', { now: expiredAt })).toBeNull();
    expect(store.file.trials['expiring-device'].status).toBe('expired');
    expect(await store.startTrial('expiring-device', {
      now: new Date('2026-08-26T12:00:00Z'),
    })).toBeNull();
  });

  it('caps changed device ids in a persistent network abuse bucket', async () => {
    const store = await fileStore();
    const now = new Date('2026-07-26T10:00:00Z');
    const options = { abuseBucket: 'bucket-one', bucketLimit: 2, now };

    expect(await store.startTrial('device-one', options)).not.toBeNull();
    expect(await store.startTrial('device-two', options)).not.toBeNull();
    expect(await store.startTrial('device-three', options)).toBeNull();
    expect(await store.startTrial('device-three', {
      ...options,
      abuseBucket: 'bucket-two',
    })).not.toBeNull();
  });

  it('verifies only configured hashes and enforces the device cap', async () => {
    const store = await fileStore();
    const key = generateLicenseKey();
    process.env.LICENSE_KEY_HASHES = JSON.stringify([hashLicenseKey(key)]);
    expect(await store.verifyLicense(key, 'device-1')).toMatchObject({ keyHash: hashLicenseKey(key) });
    expect(await store.verifyLicense('AAAA-AAAA-AAAA-AAAA-AAAA', 'device-2')).toBeNull();
  });

  it('lets a persisted revocation override an environment bootstrap key', async () => {
    const store = await fileStore();
    const key = generateLicenseKey();
    const keyHash = hashLicenseKey(key);
    process.env.LICENSE_KEY_HASHES = JSON.stringify([keyHash]);
    store.file.licenses[keyHash] = { status: 'revoked' };

    expect(await store.isLicenseActive(keyHash)).toBe(false);
  });

  it('enforces a per-owner UTC daily AI quota and resets the next day', async () => {
    const store = await fileStore();
    const dayOne = new Date('2026-07-26T23:59:00Z');
    expect(await store.consumeAiQuota('trial:one', 2, dayOne)).toBe(true);
    expect(await store.consumeAiQuota('trial:one', 2, dayOne)).toBe(true);
    expect(await store.consumeAiQuota('trial:one', 2, dayOne)).toBe(false);
    expect(await store.consumeAiQuota('trial:other', 2, dayOne)).toBe(true);
    expect(await store.consumeAiQuota('trial:one', 2, new Date('2026-07-27T00:01:00Z'))).toBe(true);
  });

  it('uses bounded pool timeouts and strict TLS even when the URL requests otherwise', () => {
    const store = postgresStore({
      databaseUrl: 'postgresql://user:database-secret@db.example.test/app?sslmode=no-verify',
      connectionTimeoutMillis: 1_234,
      queryTimeoutMillis: 5_678,
      idleTimeoutMillis: 9_012,
    });

    expect(store.pool.options).toMatchObject({
      ssl: { rejectUnauthorized: true },
      connectionTimeoutMillis: 1_234,
      query_timeout: 5_678,
      statement_timeout: 5_678,
      idleTimeoutMillis: 9_012,
    });
    expect(store.pool.options.connectionString).not.toContain('sslmode');
  });

  it('allows only an explicit constructor opt-out from certificate verification', () => {
    const store = postgresStore({ databaseTlsRejectUnauthorized: false });
    expect(store.pool.options.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('handles idle pool errors without logging the message or connection secret', () => {
    const logger = { error: vi.fn() };
    const store = postgresStore({ logger });
    store.ready = true;

    store.pool.emit(
      'error',
      Object.assign(new Error('database-secret must never be logged'), { code: 'ECONNRESET' }),
    );

    expect(store.ready).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      '[database pool] idle client error (ECONNRESET)',
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('database-secret');
  });

  it('pings PostgreSQL and becomes unready when the query fails', async () => {
    const store = postgresStore();
    vi.spyOn(store.pool, 'query')
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockRejectedValueOnce(new Error('database-secret'));

    expect(await store.ping()).toBe(true);
    expect(store.ready).toBe(true);
    expect(await store.ping()).toBe(false);
    expect(store.ready).toBe(false);
  });
});
