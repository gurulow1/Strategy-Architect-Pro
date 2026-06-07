import { defineConfig } from 'vite';

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
