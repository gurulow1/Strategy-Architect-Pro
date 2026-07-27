import { defineConfig } from 'vite';

export function assertVercelProductionApiBase(env = process.env) {
  if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'production') return;

  const value = env.VITE_API_BASE;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('VITE_API_BASE must be set to the Railway HTTPS origin for Vercel production.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.origin !== value) {
    throw new Error('VITE_API_BASE must be an exact HTTPS origin without credentials, path, query, hash, or trailing slash.');
  }
}

assertVercelProductionApiBase();

// Single-page app. Engine/analysis are pure ES modules with zero DOM deps,
// so they are unit-tested directly by Vitest without a browser.
export default defineConfig({
  root: '.',
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      include: ['src/engine/**', 'src/analysis/**'],
    },
  },
});
