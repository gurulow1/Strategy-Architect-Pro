import { describe, expect, it } from 'vitest';
import { createMtToken, readMtToken } from '../src-server/mtToken.js';

const secret = 'm'.repeat(32);
const ownerId = `lic:${'a'.repeat(32)}`;
const keyHash = 'b'.repeat(64);
const now = Date.UTC(2026, 0, 1);

describe('MetaTrader scoped tokens', () => {
  it('round-trips a valid, bounded license identity', () => {
    const token = createMtToken({ ownerId, keyHash, secret, ttlSeconds: 600, now });
    expect(readMtToken(token, { secret, now: now + 599_000 })).toMatchObject({
      ownerId,
      keyHash,
      expiresAt: now + 600_000,
    });
  });

  it('rejects expired, tampered, or wrong-secret tokens', () => {
    const token = createMtToken({ ownerId, keyHash, secret, ttlSeconds: 60, now });
    expect(readMtToken(token, { secret, now: now + 60_000 })).toBeNull();
    expect(readMtToken(`${token}x`, { secret, now })).toBeNull();
    expect(readMtToken(token, { secret: 'x'.repeat(32), now })).toBeNull();
  });

  it('rejects malformed identities before signing', () => {
    expect(() => createMtToken({
      ownerId: 'lic:short',
      keyHash,
      secret,
      now,
    })).toThrow(TypeError);
  });
});
