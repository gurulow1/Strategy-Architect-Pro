import { describe, expect, it } from 'vitest';
import { generateLicenseKey, hashLicenseKey, normalizeLicenseKey } from '../src-server/licenseKeys.js';

describe('human-friendly activation keys', () => {
  it('generates a short checksummed key and accepts pasted separators/case', () => {
    const key = generateLicenseKey();
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){4}$/);
    expect(normalizeLicenseKey(key.toLowerCase())).toBe(key.replaceAll('-', ''));
    expect(hashLicenseKey(key)).toHaveLength(64);
  });

  it('rejects a mistyped checksum but keeps legacy keys compatible', () => {
    const key = generateLicenseKey().replaceAll('-', '');
    const last = key.at(-1) === '0' ? '1' : '0';
    expect(normalizeLicenseKey(key.slice(0, -1) + last)).toBeNull();
    expect(normalizeLicenseKey('0123456789abcdef0123456789abcdef')).toBe('0123456789abcdef0123456789abcdef');
  });
});
