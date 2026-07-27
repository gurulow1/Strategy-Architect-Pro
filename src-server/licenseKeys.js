import crypto from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BASE32_RE = /^[0-9A-HJKMNP-TV-Z]{20}$/;
const LEGACY_RE = /^[0-9a-f]{32}$/i;

function checksum(body) {
  let value = 0;
  for (const char of body) value = (value * 33 + ALPHABET.indexOf(char)) % 32;
  return ALPHABET[value];
}

export function normalizeLicenseKey(input) {
  if (typeof input !== 'string') return null;
  const compact = input.trim().replace(/[\s-]+/g, '');
  if (LEGACY_RE.test(compact)) return compact.toLowerCase();

  const normalized = compact.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!BASE32_RE.test(normalized)) return null;
  return checksum(normalized.slice(0, -1)) === normalized.at(-1) ? normalized : null;
}

export function hashLicenseKey(input) {
  const normalized = normalizeLicenseKey(input);
  return normalized
    ? crypto.createHash('sha256').update(normalized, 'utf8').digest('hex')
    : null;
}

export function generateLicenseKey() {
  let body = '';
  while (body.length < 19) {
    for (const byte of crypto.randomBytes(19)) {
      if (byte >= 224) continue;
      body += ALPHABET[byte % 32];
      if (body.length === 19) break;
    }
  }
  const compact = body + checksum(body);
  return compact.match(/.{1,4}/g).join('-');
}
