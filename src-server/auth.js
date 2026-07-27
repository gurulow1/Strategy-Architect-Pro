import crypto from 'node:crypto';
import { isIP } from 'node:net';
import jwt from 'jsonwebtoken';
import { TRIAL_DURATION_MS } from './accessStore.js';
import { hashLicenseKey } from './licenseKeys.js';

const DEVICE_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const TRIAL_DEVICE_COOKIE = 'sap_trial_device';
const LICENSE_DEVICE_COOKIE = 'sap_license_device';
const TRIAL_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const LICENSE_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timingDelay = () => delay(80 + crypto.randomInt(0, 41));

function opaqueHash(secret, value) {
  return crypto.createHmac('sha256', secret).update(String(value), 'utf8').digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function readCookie(req, name) {
  const prefix = `${name}=`;
  for (const part of String(req.get('cookie') || '').split(';')) {
    const value = part.trim();
    if (value.startsWith(prefix)) {
      try { return decodeURIComponent(value.slice(prefix.length)); } catch { return null; }
    }
  }
  return null;
}

function readBearer(req) {
  const value = req.get('authorization') || '';
  return /^Bearer[ \t]+(\S+)$/i.exec(value)?.[1] || null;
}

function ipv6Prefix(value) {
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const fill = 8 - left.length - right.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const groups = [...left, ...Array(fill).fill('0'), ...right];
  if (groups.some((group) => !/^[a-f0-9]{1,4}$/i.test(group))) return null;
  return groups.slice(0, 4).map((group) => group.padStart(4, '0')).join(':');
}

function networkPrefix(value) {
  let ip = String(value || '').trim().toLowerCase();
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) === 6) return ipv6Prefix(ip);
  return null;
}

function userAgentFamily(value) {
  const ua = String(value || '').toLowerCase();
  if (/\b(edg|edga|edgios)\//.test(ua)) return 'edge';
  if (/\b(firefox|fxios)\//.test(ua)) return 'firefox';
  if (/\b(chrome|crios)\//.test(ua)) return 'chrome';
  if (/\bsafari\//.test(ua)) return 'safari';
  return 'other';
}

export function createAuth({ store, secret, appMode = 'license' }) {
  const sign = (payload, expiresIn) => jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn,
    issuer: 'strategy-architect-pro',
    audience: 'strategy-architect-web',
  });

  const signUntil = (payload, expiresAt) => jwt.sign({
    ...payload,
    exp: Math.floor(expiresAt / 1000),
  }, secret, {
    algorithm: 'HS256',
    issuer: 'strategy-architect-pro',
    audience: 'strategy-architect-web',
  });

  const verify = (token) => jwt.verify(token, secret, {
    algorithms: ['HS256'],
    issuer: 'strategy-architect-pro',
    audience: 'strategy-architect-web',
  });

  function licensedDeviceHash(req, keyHash) {
    const token = readCookie(req, LICENSE_DEVICE_COOKIE);
    if (!token) return null;
    try {
      const payload = verify(token);
      return payload.type === 'licensed_device'
        && payload.kh === keyHash
        && /^[a-f0-9]{64}$/.test(payload.dh || '')
        ? payload.dh
        : null;
    } catch {
      return null;
    }
  }

  function setLicensedDeviceCookie(req, res, keyHash, deviceHash) {
    const secure = req.secure || req.get('x-forwarded-proto') === 'https';
    const token = sign({
      type: 'licensed_device',
      kh: keyHash,
      dh: deviceHash,
    }, Math.floor(LICENSE_COOKIE_MAX_AGE_MS / 1000));
    res.cookie(LICENSE_DEVICE_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: secure ? 'none' : 'lax',
      path: '/api',
      maxAge: LICENSE_COOKIE_MAX_AGE_MS,
    });
  }

  function trialIdentity(req, res, deviceId) {
    const cookie = readCookie(req, TRIAL_DEVICE_COOKIE);
    const match = /^([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(cookie || '');
    const cookieFingerprint = match
      && safeEqual(match[2], opaqueHash(secret, `trial-cookie:${match[1]}`))
      ? match[1]
      : null;
    const fingerprint = cookieFingerprint || opaqueHash(secret, deviceId);
    const signature = opaqueHash(secret, `trial-cookie:${fingerprint}`);
    const secure = req.secure || req.get('x-forwarded-proto') === 'https';
    res.cookie(TRIAL_DEVICE_COOKIE, `${fingerprint}.${signature}`, {
      httpOnly: true,
      secure,
      sameSite: secure ? 'none' : 'lax',
      path: '/api/trial',
      maxAge: TRIAL_COOKIE_MAX_AGE_MS,
    });
    const prefix = networkPrefix(req.ip);
    const abuseBucket = prefix
      ? opaqueHash(secret, `trial-abuse:${prefix}:${userAgentFamily(req.get('user-agent'))}`)
      : null;
    return { fingerprint, abuseBucket };
  }

  async function verifyToken(req) {
    const token = readBearer(req);
    if (!token) return null;
    const payload = verify(token);
    if (payload.type === 'license') {
      return await store.isLicenseActive(payload.kh) ? payload : null;
    }
    if (payload.type === 'trial') {
      return await store.isTrialActive(payload.fp, payload.trialId) ? payload : null;
    }
    return appMode === 'open' && payload.type === 'open' ? payload : null;
  }

  function requireAccess({ licenseOnly = false } = {}) {
    return async (req, res, next) => {
      if (appMode === 'open' && !licenseOnly) {
        req.tokenPayload = { type: 'open', sub: 'open' };
        return next();
      }
      try {
        const payload = await verifyToken(req);
        if (!payload || (licenseOnly && payload.type !== 'license')) {
          return res.status(401).json({ error: licenseOnly ? 'Activation required' : 'Unauthorized' });
        }
        req.tokenPayload = payload;
        return next();
      } catch (error) {
        const expired = error?.name === 'TokenExpiredError';
        return res.status(401).json({
          error: expired ? 'Token expired' : 'Unauthorized',
          ...(expired ? { code: 'TOKEN_EXPIRED' } : {}),
        });
      }
    };
  }

  async function verifyLicense(req, res) {
    const { key, rememberMe = true } = req.body || {};
    const keyHash = hashLicenseKey(key);
    if (!keyHash) {
      await timingDelay();
      return res.status(401).json({ error: 'Invalid activation key' });
    }
    const deviceHash = licensedDeviceHash(req, keyHash)
      || opaqueHash(secret, `licensed-device:${crypto.randomBytes(32).toString('hex')}`);
    const result = await store.verifyLicense(key, deviceHash);
    await timingDelay();
    if (!result || result.error) {
      return res.status(result?.error === 'DEVICE_LIMIT' ? 409 : 401).json({
        error: result?.error === 'DEVICE_LIMIT'
          ? 'Device limit reached'
          : 'Invalid activation key',
        ...(result?.error ? { code: result.error } : {}),
      });
    }
    setLicensedDeviceCookie(req, res, result.keyHash, deviceHash);
    const sub = `lic:${result.keyHash.slice(0, 32)}`;
    return res.json({
      token: sign({ type: 'license', sub, kh: result.keyHash }, rememberMe ? '7d' : '12h'),
      access: 'license',
    });
  }

  async function startTrial(req, res) {
    if (appMode === 'open') {
      return res.json({ token: sign({ type: 'open', sub: 'open' }, '12h'), access: 'open' });
    }
    const { deviceId } = req.body || {};
    if (!DEVICE_RE.test(String(deviceId || ''))) {
      return res.status(400).json({ error: 'Invalid device id' });
    }
    const { fingerprint, abuseBucket } = trialIdentity(req, res, deviceId);
    const trial = await store.startTrial(fingerprint, { abuseBucket });
    if (!trial) return res.status(403).json({ error: 'Trial already used', code: 'TRIAL_USED' });
    const startedAt = new Date(trial.started_at ?? trial.startedAt).getTime();
    const expiresAt = startedAt + TRIAL_DURATION_MS;
    if (!Number.isFinite(startedAt)
      || Math.floor(expiresAt / 1000) <= Math.floor(Date.now() / 1000)) {
      return res.status(403).json({ error: 'Trial already used', code: 'TRIAL_USED' });
    }
    const sub = `trial:${trial.trial_id}`;
    return res.json({
      token: signUntil({
        type: 'trial',
        sub,
        fp: fingerprint,
        trialId: trial.trial_id,
      }, expiresAt),
      access: 'trial',
      expiresAt: new Date(expiresAt).toISOString(),
    });
  }

  async function completeTrial(req, res) {
    if (req.tokenPayload?.type !== 'trial') return res.json({ ok: true });
    const consumed = await store.consumeTrial(req.tokenPayload.fp, req.tokenPayload.trialId);
    return consumed
      ? res.json({ ok: true })
      : res.status(409).json({ ok: false, error: 'Trial is not active', code: 'TRIAL_NOT_ACTIVE' });
  }

  async function session(req, res) {
    try {
      const payload = await verifyToken(req);
      return res.json({
        authenticated: Boolean(payload),
        access: payload?.type || null,
        trialActive: payload?.type === 'trial',
      });
    } catch {
      return res.json({ authenticated: false, access: null, trialActive: false });
    }
  }

  return {
    verifyLicense,
    startTrial,
    completeTrial,
    session,
    requireAccess,
  };
}
