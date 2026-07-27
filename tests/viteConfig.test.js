import { describe, expect, it } from 'vitest';
import { assertVercelProductionApiBase } from '../vite.config.js';

const vercelProduction = { VERCEL: '1', VERCEL_ENV: 'production' };

describe('Vercel frontend API routing guard', () => {
  it('requires an exact HTTPS backend origin in production', () => {
    expect(() => assertVercelProductionApiBase(vercelProduction)).toThrow(/VITE_API_BASE/);
    expect(() => assertVercelProductionApiBase({
      ...vercelProduction,
      VITE_API_BASE: 'http://api.example.com',
    })).toThrow(/exact HTTPS origin/);
    expect(() => assertVercelProductionApiBase({
      ...vercelProduction,
      VITE_API_BASE: 'https://api.example.com/',
    })).toThrow(/exact HTTPS origin/);
    expect(() => assertVercelProductionApiBase({
      ...vercelProduction,
      VITE_API_BASE: 'https://api.example.com',
    })).not.toThrow();
  });

  it('allows same-origin builds outside Vercel production', () => {
    expect(() => assertVercelProductionApiBase({})).not.toThrow();
    expect(() => assertVercelProductionApiBase({
      VERCEL: '1',
      VERCEL_ENV: 'preview',
    })).not.toThrow();
  });
});
