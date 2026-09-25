/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { DEV_CACHE_FOLDER } from './scripts/dev-servers';

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
  // v1.7.1 A-6 (W-I D-I13 chip): Vitest's results cache (test ordering —
  // failed first, then slowest) resolves to `<cacheDir>/vitest/<hash>/results.json`.
  // Vite's default `node_modules/.vite` is SHARED by every worktree whose
  // node_modules is a symlink to the main checkout, so two trees' runs rewrote
  // one file. `.vite.local` is the D-I1 folder (rides .gitignore's `*.local`);
  // the dev servers keep their `.vite.local/<role>` siblings.
  cacheDir: path.resolve(__dirname, DEV_CACHE_FOLDER),
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
    // Default is 5_000 ms. The EquityGrantsTab vesting-template tests
    // mount a 37-row schedule (each row is a DatePicker + Input + button)
    // and the FOUR_YR_MONTHLY_ONE_YR_CLIFF tests sit at ~5.2s under the
    // full-suite parallel contention introduced by additional store
    // imports (transactions / snapshots / asset-value-snapshots now ship
    // optimistic mutation paths in their module bodies). 10s is a
    // comfortable margin that doesn't hide actual hangs — most tests
    // continue to complete in under 1 second.
    testTimeout: 10_000,
  },
});
