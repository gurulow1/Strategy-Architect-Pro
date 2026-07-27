import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (name) => JSON.parse(readFileSync(path.join(root, name), 'utf8'));

describe('deployment configuration', () => {
  it('uses Railway Railpack and the readiness endpoint', () => {
    const config = readJson('railway.json');
    expect(config.$schema).toBe('https://railway.com/railway.schema.json');
    expect(config.build?.builder).toBe('RAILPACK');
    expect(config.deploy).toMatchObject({
      startCommand: 'node server.js',
      healthcheckPath: '/ready',
      restartPolicyType: 'ON_FAILURE',
    });
  });

  it('keeps the Vercel frontend on the Vite build with security headers', () => {
    const config = readJson('vercel.json');
    expect(config.framework).toBe('vite');
    const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]));
    expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
  });
});
