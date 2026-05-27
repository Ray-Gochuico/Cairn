/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// STRESS=1 toggles in `tests/stress/**` files (e.g., 50-year engine
// projections, 25k-row component renders). Default `npm test` excludes
// them so the fast suite stays under 60s. Use `npm run test:stress` to
// run them in isolation.
//
// Wave-3 review (docs/reviews/2026-05-27-testing-wave3.md § N4) flagged
// the recurring untracked-stress-file pattern: each review wave produces
// a `wave3-bench.test.ts`-style file that auto-runs and pays a runtime
// tax. The fix is structural — stress tests are tracked and committed,
// but the default test run skips them.
const stressEnabled = process.env.STRESS === '1';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: stressEnabled
      ? configDefaults.exclude
      : [...configDefaults.exclude, 'tests/stress/**'],
  },
});
