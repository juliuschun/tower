import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'packages/frontend/src'),
      '@tower/shared': path.resolve(__dirname, 'packages/shared/index.ts'),
    },
  },
  test: {
    globals: true,
    environmentMatchGlobs: [
      ['packages/frontend/**/*.test.{ts,tsx}', 'jsdom'],
      ['packages/backend/**/*.test.ts', 'node'],
    ],
    include: [
      'packages/backend/**/*.test.ts',
      'packages/frontend/**/*.test.{ts,tsx}',
      'packages/shared/**/*.test.ts',
      '__tests__/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '__tests__/build-smoke.test.ts',
    ],
  },
});
