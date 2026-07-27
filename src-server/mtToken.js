import crypto from 'node:crypto';

const OWNER_RE = /^lic:[a-f0-9]{32}$/;
const KEY_HASH_RE = /^[a-f0-9]{64}$/;

function equal(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

export function createMtToken({
  ownerId,
  keyHash,
  secret,
  ttlSeconds = 7 * 24 * 60 * 60,
  now = Date.now(),
}) {
  if (!OWNER_RE.test(ownerId || '')
    || !KEY_HASH_RE.test(keyHash || '')
    || typeof secret !== 'string'
    || secret.length < 32
    || !Number.isInteger(ttlSeconds)
    || ttlSeconds < 60) {
    throw new TypeError('Invalid MetaTrader token parameters');
  }
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    ownerId,
    keyHash,
    exp: Math.floor(now / 1000) + ttlSeconds,
  }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function readMtToken(token, { secret, now = Date.now() } = {}) {
  if (typeof token !== 'string' || typeof secret !== 'string' || secret.length < 32) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!equal(signature, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (parsed?.v !== 1
      || !OWNER_RE.test(parsed.ownerId || '')
      || !KEY_HASH_RE.test(parsed.keyHash || '')
      || !Number.isInteger(parsed.exp)
      || parsed.exp <= Math.floor(now / 1000)) {
      return null;
    }
    return { ownerId: parsed.ownerId, keyHash: parsed.keyHash, expiresAt: parsed.exp * 1000 };
  } catch {
    return null;
  }
}
