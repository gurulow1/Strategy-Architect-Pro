import crypto from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { hashLicenseKey, normalizeLicenseKey } from './licenseKeys.js';

const { Pool } = pg;
export const TRIAL_DURATION_MS = 2 * 60 * 60 * 1000;
export const TRIAL_BUCKET_LIMIT = 8;
export const TRIAL_BUCKET_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function trialStartedAt(trial) {
  return new Date(trial?.started_at ?? trial?.startedAt ?? Number.NaN).getTime();
}

function trialIsWithinWindow(trial, now) {
  const startedAt = trialStartedAt(trial);
  return Number.isFinite(startedAt)
    && startedAt <= now.getTime()
    && now.getTime() - startedAt < TRIAL_DURATION_MS;
}
const DATABASE_SSL_PARAMS = [
  'ssl',
  'sslmode',
  'sslcert',
  'sslkey',
  'sslrootcert',
  'sslnegotiation',
  'uselibpqcompat',
];

function positiveMilliseconds(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function securedConnectionString(value) {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
    for (const parameter of DATABASE_SSL_PARAMS) url.searchParams.delete(parameter);
    return url.toString();
  } catch {
    throw new Error('Invalid DATABASE_URL');
  }
}

function safePoolErrorCode(error) {
  const code = String(error?.code || '');
  return /^[A-Z0-9_-]{1,32}$/.test(code) ? code : 'UNKNOWN';
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function envLicenseHashes() {
  const configured = parseJson(process.env.LICENSE_KEY_HASHES, []);
  const hashes = new Set(Array.isArray(configured) ? configured : Object.keys(configured || {}));

  // Migration path only: old deployments may still contain plaintext 32-char keys.
  const legacy = parseJson(process.env.LICENSE_KEYS, []);
  const keys = Array.isArray(legacy) ? legacy : Object.keys(legacy || {});
  for (const key of keys) {
    const hash = hashLicenseKey(key);
    if (hash) hashes.add(hash);
  }
  return hashes;
}

function emptyFileStore() {
  return {
    trials: {},
    licenses: {},
    devices: {},
    telegramLinks: {},
    telegramCodes: {},
    mtSnapshots: {},
    aiUsage: {},
  };
}

export class AccessStore {
  constructor({
    databaseUrl = process.env.DATABASE_URL,
    filePath = process.env.ACCESS_STORE_PATH || path.resolve('.data/access.json'),
    databaseTlsRejectUnauthorized = process.env.DATABASE_TLS_REJECT_UNAUTHORIZED !== 'false',
    connectionTimeoutMillis = positiveMilliseconds(
      process.env.DATABASE_CONNECTION_TIMEOUT_MS,
      5_000,
    ),
    queryTimeoutMillis = positiveMilliseconds(process.env.DATABASE_QUERY_TIMEOUT_MS, 10_000),
    idleTimeoutMillis = positiveMilliseconds(process.env.DATABASE_IDLE_TIMEOUT_MS, 30_000),
    logger = console,
  } = {}) {
    this.pool = databaseUrl
      ? new Pool({
        connectionString: securedConnectionString(databaseUrl),
        ssl: { rejectUnauthorized: databaseTlsRejectUnauthorized },
        connectionTimeoutMillis,
        query_timeout: queryTimeoutMillis,
        statement_timeout: queryTimeoutMillis,
        idleTimeoutMillis,
      })
      : null;
    if (this.pool) {
      this.pool.on('error', (error) => {
        this.ready = false;
        logger.error(`[database pool] idle client error (${safePoolErrorCode(error)})`);
      });
    }
    this.filePath = filePath;
    this.file = emptyFileStore();
    this.writeQueue = Promise.resolve();
    this.ready = false;
  }

  async init() {
    if (this.pool) {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS licenses (
          key_hash TEXT PRIMARY KEY,
          label TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          expires_at TIMESTAMPTZ,
          max_devices INTEGER NOT NULL DEFAULT 3,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS license_devices (
          key_hash TEXT NOT NULL,
          device_hash TEXT NOT NULL,
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (key_hash, device_hash)
        );
        CREATE TABLE IF NOT EXISTS trials (
          fingerprint TEXT PRIMARY KEY,
          trial_id TEXT NOT NULL UNIQUE,
          abuse_bucket TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          consumed_at TIMESTAMPTZ
        );
        ALTER TABLE trials ADD COLUMN IF NOT EXISTS abuse_bucket TEXT;
        CREATE INDEX IF NOT EXISTS trials_abuse_bucket_started_idx
          ON trials (abuse_bucket, started_at);
        CREATE TABLE IF NOT EXISTS telegram_links (
          owner_id TEXT PRIMARY KEY,
          chat_id BIGINT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS telegram_codes (
          code TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS mt_snapshots (
          owner_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          trades JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (owner_id, account_id)
        );
        CREATE TABLE IF NOT EXISTS ai_usage (
          owner_id TEXT NOT NULL,
          usage_date DATE NOT NULL,
          calls INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (owner_id, usage_date)
        );
      `);
    } else {
      try {
        this.file = { ...emptyFileStore(), ...JSON.parse(await readFile(this.filePath, 'utf8')) };
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    this.ready = true;
  }

  async close() {
    await this.writeQueue;
    this.ready = false;
    if (this.pool) await this.pool.end();
  }

  async ping() {
    if (!this.pool) return this.ready;
    try {
      await this.pool.query('SELECT 1');
      this.ready = true;
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  async saveFile() {
    if (this.pool) return;
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(this.file), { encoding: 'utf8', mode: 0o600 });
      await rename(temp, this.filePath);
    });
    return this.writeQueue;
  }

  async verifyLicense(rawKey, deviceHash) {
    const normalized = normalizeLicenseKey(rawKey);
    const keyHash = normalized && hashLicenseKey(normalized);
    if (!keyHash) return null;

    let maxDevices = 3;
    let matched = envLicenseHashes().has(keyHash);

    if (this.pool) {
      const { rows } = await this.pool.query(
        `SELECT status, expires_at, max_devices FROM licenses WHERE key_hash = $1`,
        [keyHash],
      );
      const license = rows[0];
      if (license) {
        matched = license.status === 'active'
          && (!license.expires_at || new Date(license.expires_at).getTime() > Date.now());
        maxDevices = license.max_devices;
      }
    } else if (this.file.licenses[keyHash]) {
      const license = this.file.licenses[keyHash];
      matched = license.status !== 'revoked'
        && (!license.expiresAt || new Date(license.expiresAt).getTime() > Date.now());
      maxDevices = license.maxDevices || 3;
    }

    if (!matched) return null;
    if (deviceHash && !(await this.registerDevice(keyHash, deviceHash, maxDevices))) {
      return { error: 'DEVICE_LIMIT' };
    }
    return { keyHash };
  }

  async isLicenseActive(keyHash) {
    if (!/^[a-f0-9]{64}$/.test(keyHash || '')) return false;
    if (this.pool) {
      const { rows } = await this.pool.query(
        `SELECT status, expires_at FROM licenses WHERE key_hash = $1`,
        [keyHash],
      );
      if (rows[0]) {
        return rows[0].status === 'active'
          && (!rows[0].expires_at || new Date(rows[0].expires_at).getTime() > Date.now());
      }
      return envLicenseHashes().has(keyHash);
    }
    const license = this.file.licenses[keyHash];
    if (license) {
      return license.status !== 'revoked'
        && (!license.expiresAt || new Date(license.expiresAt).getTime() > Date.now());
    }
    return envLicenseHashes().has(keyHash);
  }

  async registerDevice(keyHash, deviceHash, maxDevices) {
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [keyHash]);
        const existing = await client.query(
          `SELECT 1 FROM license_devices WHERE key_hash = $1 AND device_hash = $2`,
          [keyHash, deviceHash],
        );
        if (!existing.rowCount) {
          const count = await client.query(
            `SELECT COUNT(*)::int AS count FROM license_devices WHERE key_hash = $1`,
            [keyHash],
          );
          if (count.rows[0].count >= maxDevices) {
            await client.query('ROLLBACK');
            return false;
          }
          await client.query(
            `INSERT INTO license_devices (key_hash, device_hash) VALUES ($1, $2)`,
            [keyHash, deviceHash],
          );
        } else {
          await client.query(
            `UPDATE license_devices SET last_seen_at = NOW() WHERE key_hash = $1 AND device_hash = $2`,
            [keyHash, deviceHash],
          );
        }
        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    const devices = this.file.devices[keyHash] || [];
    if (!devices.includes(deviceHash) && devices.length >= maxDevices) return false;
    if (!devices.includes(deviceHash)) devices.push(deviceHash);
    this.file.devices[keyHash] = devices;
    await this.saveFile();
    return true;
  }

  async startTrial(fingerprint, {
    abuseBucket = null,
    now = new Date(),
    bucketLimit = TRIAL_BUCKET_LIMIT,
  } = {}) {
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        if (abuseBucket) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [abuseBucket]);
        }
        const existing = await client.query(
          `SELECT trial_id, status, started_at FROM trials WHERE fingerprint = $1`,
          [fingerprint],
        );
        const trial = existing.rows[0];
        if (trial) {
          if (trial.status === 'active' && trialIsWithinWindow(trial, now)) {
            await client.query('COMMIT');
            return trial;
          }
          if (trial.status === 'active') {
            await client.query(
              `UPDATE trials SET status = 'expired'
               WHERE fingerprint = $1 AND trial_id = $2 AND status = 'active'`,
              [fingerprint, trial.trial_id],
            );
          }
          await client.query('COMMIT');
          return null;
        }

        if (abuseBucket) {
          const recent = await client.query(
            `SELECT COUNT(*)::int AS count FROM trials
             WHERE abuse_bucket = $1
               AND started_at > $2::timestamptz - INTERVAL '30 days'`,
            [abuseBucket, now],
          );
          if (recent.rows[0].count >= bucketLimit) {
            await client.query('ROLLBACK');
            return null;
          }
        }

        const trialId = crypto.randomUUID();
        const inserted = await client.query(
          `INSERT INTO trials (fingerprint, trial_id, abuse_bucket, started_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (fingerprint) DO NOTHING
           RETURNING trial_id, status, started_at`,
          [fingerprint, trialId, abuseBucket, now],
        );
        if (inserted.rowCount) {
          await client.query('COMMIT');
          return inserted.rows[0];
        }
        const raced = await client.query(
          `SELECT trial_id, status, started_at FROM trials WHERE fingerprint = $1`,
          [fingerprint],
        );
        await client.query('COMMIT');
        return raced.rows[0]?.status === 'active' && trialIsWithinWindow(raced.rows[0], now)
          ? raced.rows[0]
          : null;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    const current = this.file.trials[fingerprint];
    if (current) {
      if (current.status !== 'active') return null;
      if (trialIsWithinWindow(current, now)) return current;
      current.status = 'expired';
      current.expiredAt = now.toISOString();
      await this.saveFile();
      return null;
    }
    if (abuseBucket) {
      const cutoff = now.getTime() - TRIAL_BUCKET_WINDOW_MS;
      const recent = Object.values(this.file.trials).filter((trial) => (
        trial.abuseBucket === abuseBucket && trialStartedAt(trial) > cutoff
      )).length;
      if (recent >= bucketLimit) return null;
    }
    const trial = {
      trial_id: crypto.randomUUID(),
      status: 'active',
      startedAt: now.toISOString(),
      ...(abuseBucket ? { abuseBucket } : {}),
    };
    this.file.trials[fingerprint] = trial;
    await this.saveFile();
    return trial;
  }

  async isTrialActive(fingerprint, trialId, now = new Date()) {
    if (this.pool) {
      const { rows } = await this.pool.query(
        `SELECT status, started_at FROM trials
         WHERE fingerprint = $1 AND trial_id = $2
           AND status IN ('active', 'consumed')
           AND started_at <= $3
           AND started_at > $3::timestamptz - INTERVAL '2 hours'`,
        [fingerprint, trialId, now],
      );
      return rows.length === 1;
    }
    const trial = this.file.trials[fingerprint];
    return trial?.trial_id === trialId
      && (trial.status === 'active' || trial.status === 'consumed')
      && trialIsWithinWindow(trial, now);
  }

  async consumeTrial(fingerprint, trialId, now = new Date()) {
    if (this.pool) {
      const result = await this.pool.query(
        `UPDATE trials
         SET status = 'consumed', consumed_at = COALESCE(consumed_at, $3)
         WHERE fingerprint = $1 AND trial_id = $2
           AND status IN ('active', 'consumed')
           AND started_at <= $3
           AND started_at > $3::timestamptz - INTERVAL '2 hours'`,
        [fingerprint, trialId, now],
      );
      return result.rowCount === 1;
    }
    const trial = this.file.trials[fingerprint];
    if (trial?.trial_id !== trialId || !trialIsWithinWindow(trial, now)) return false;
    if (trial.status === 'consumed') return true;
    if (trial.status !== 'active') return false;
    trial.status = 'consumed';
    trial.consumedAt = now.toISOString();
    await this.saveFile();
    return true;
  }

  async consumeAiQuota(ownerId, limit, now = new Date()) {
    if (typeof ownerId !== 'string' || !ownerId || !Number.isInteger(limit) || limit < 1) {
      return false;
    }
    const usageDate = new Date(now).toISOString().slice(0, 10);
    if (this.pool) {
      const { rows } = await this.pool.query(
        `INSERT INTO ai_usage (owner_id, usage_date, calls)
         VALUES ($1, $2::date, 1)
         ON CONFLICT (owner_id, usage_date)
         DO UPDATE SET calls = ai_usage.calls + 1
         WHERE ai_usage.calls < $3
         RETURNING calls`,
        [ownerId, usageDate, limit],
      );
      return rows.length === 1;
    }
    const key = `${ownerId}:${usageDate}`;
    const calls = Number(this.file.aiUsage[key] || 0);
    if (calls >= limit) return false;
    this.file.aiUsage[key] = calls + 1;
    await this.saveFile();
    return true;
  }

  async createTelegramCode(ownerId, code, expiresAt) {
    if (this.pool) {
      await this.pool.query(`DELETE FROM telegram_codes WHERE owner_id = $1 OR expires_at <= NOW()`, [ownerId]);
      await this.pool.query(
        `INSERT INTO telegram_codes (code, owner_id, expires_at) VALUES ($1, $2, $3)`,
        [code, ownerId, expiresAt],
      );
      return;
    }
    const now = Date.now();
    for (const [storedCode, entry] of Object.entries(this.file.telegramCodes)) {
      if (entry.ownerId === ownerId || new Date(entry.expiresAt).getTime() <= now) {
        delete this.file.telegramCodes[storedCode];
      }
    }
    this.file.telegramCodes[code] = { ownerId, expiresAt: new Date(expiresAt).toISOString() };
    await this.saveFile();
  }

  async consumeTelegramCode(code, chatId) {
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `DELETE FROM telegram_codes
           WHERE code = $1 AND expires_at > NOW()
           RETURNING owner_id`,
          [code],
        );
        const ownerId = result.rows[0]?.owner_id;
        if (!ownerId) {
          await client.query('ROLLBACK');
          return null;
        }
        await client.query(
          `INSERT INTO telegram_links (owner_id, chat_id) VALUES ($1, $2)
           ON CONFLICT (owner_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, updated_at = NOW()`,
          [ownerId, chatId],
        );
        await client.query('COMMIT');
        return ownerId;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    const entry = this.file.telegramCodes[code];
    if (!entry || new Date(entry.expiresAt).getTime() <= Date.now()) return null;
    this.file.telegramLinks[entry.ownerId] = String(chatId);
    delete this.file.telegramCodes[code];
    await this.saveFile();
    return entry.ownerId;
  }

  async getTelegramChat(ownerId) {
    if (this.pool) {
      const { rows } = await this.pool.query(
        `SELECT chat_id FROM telegram_links WHERE owner_id = $1`,
        [ownerId],
      );
      return rows[0]?.chat_id ?? null;
    }
    return this.file.telegramLinks[ownerId] ?? null;
  }

  async unlinkTelegramOwner(ownerId) {
    if (this.pool) {
      await this.pool.query(`DELETE FROM telegram_links WHERE owner_id = $1`, [ownerId]);
      return;
    }
    delete this.file.telegramLinks[ownerId];
    await this.saveFile();
  }

  async unlinkTelegramChat(chatId) {
    if (this.pool) {
      await this.pool.query(`DELETE FROM telegram_links WHERE chat_id = $1`, [chatId]);
      return;
    }
    for (const [ownerId, storedChatId] of Object.entries(this.file.telegramLinks)) {
      if (String(storedChatId) === String(chatId)) delete this.file.telegramLinks[ownerId];
    }
    await this.saveFile();
  }

  async storeMtSnapshot(ownerId, accountId, trades) {
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO mt_snapshots (owner_id, account_id, trades) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (owner_id, account_id)
         DO UPDATE SET trades = EXCLUDED.trades, updated_at = NOW()`,
        [ownerId, accountId, JSON.stringify(trades)],
      );
      return;
    }
    this.file.mtSnapshots[`${ownerId}:${accountId}`] = {
      trades,
      updatedAt: new Date().toISOString(),
    };
    await this.saveFile();
  }

  async getMtSnapshot(ownerId, accountId) {
    if (this.pool) {
      const { rows } = await this.pool.query(
        `SELECT trades, updated_at FROM mt_snapshots WHERE owner_id = $1 AND account_id = $2`,
        [ownerId, accountId],
      );
      return rows[0]
        ? { trades: rows[0].trades, updatedAt: new Date(rows[0].updated_at).toISOString() }
        : null;
    }
    return this.file.mtSnapshots[`${ownerId}:${accountId}`] || null;
  }
}
