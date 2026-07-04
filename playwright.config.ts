import { defineConfig } from '@playwright/test';

/**
 * Browser-shim smoke scaffold (Wave 5). Runs the SAME app the desktop build
 * ships, on the sql.js adapter with seeded demo data — real router, real
 * stores, real recharts, real migrations. Two scenarios only; the fuller
 * suite is a follow-up once this proves stable in CI (the job starts as
 * continue-on-error).
 *
 * Port 1422 is pinned by dev:browser:seed (--strictPort), so a stray vite on
 * 1420/1421 can't be smoke-tested by accident.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:1422',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev:browser:seed',
    url: 'http://localhost:1422',
    reuseExistingServer: !process.env.CI,
    // Cold start = vite + sql.js wasm fetch + 47 migrations + demo seed.
    timeout: 120_000,
  },
});
