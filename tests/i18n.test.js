import { describe, it, expect } from 'vitest';
import en from '../src/i18n/en.js';
import ru from '../src/i18n/ru.js';

// The bilingual dictionaries must stay in lock-step: every key present in one
// must exist in the other, or the UI silently falls back to English (or the
// raw key) for the missing language. This guard catches drift at test time.
describe('i18n dictionary parity', () => {
  const enKeys = Object.keys(en);
  const ruKeys = Object.keys(ru);

  it('has no keys missing from RU', () => {
    const missing = enKeys.filter((k) => !(k in ru));
    expect(missing, `missing in ru.js: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no keys missing from EN', () => {
    const missing = ruKeys.filter((k) => !(k in en));
    expect(missing, `missing in en.js: ${missing.join(', ')}`).toEqual([]);
  });

  it('has non-empty string values in both', () => {
    const bad = enKeys.filter((k) => typeof en[k] !== 'string' || en[k] === '')
      .concat(ruKeys.filter((k) => typeof ru[k] !== 'string' || ru[k] === ''));
    expect(bad).toEqual([]);
  });
});
