import { randomUUID } from 'node:crypto';
import { defineConfig } from '@playwright/test';
import { E2E_SERVERS, FRESH_SERVER, SEEDED_SERVER } from './e2e/servers';

/**
 * Browser-shim smoke scaffold (Wave 5). Runs the SAME app the desktop build
 * ships, on the sql.js adapter with seeded demo data — real router, real
 * stores, real recharts, real migrations.
 *
 * Ports 1422/1423 are pinned by the two npm scripts (--strictPort), so a
 * stray vite on 1420/1421 can't be smoke-tested by accident.
 */

// W-I D-I3: one nonce per run, minted ONLY in the main process (workers carry
// TEST_WORKER_INDEX and re-evaluate this file with the inherited env), passed
// to every dev server this run launches. A server that cannot echo it was not
// launched by this run — e2e/global-setup.ts refuses to test it.
if (!process.env.TEST_WORKER_INDEX) process.env.CAIRN_DEV_NONCE = randomUUID();
const NONCE = process.env.CAIRN_DEV_NONCE ?? '';

// W-I D-I4: attaching to an already-running server is OPT-IN. Default off in
// every environment (CI included): v1.6.0's `!process.env.CI` silently
// attached a main-checkout run to a sibling worktree's servers and tested
// THAT tree (the run received its renamed seed persons). With reuse off a
// busy port fails at Playwright's own check before anything runs; with
// PW_REUSE_SERVER=1 the global setup still refuses a server from another tree.
const REUSE = process.env.PW_REUSE_SERVER === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  metadata: { reuseExistingServer: REUSE },
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // The seeded smoke suite (disclosures accepted, demo data present).
      name: 'seeded',
      // [^/] keeps the match inside the FILENAME segment — a plain .* would
      // also match when a parent directory name contains "onboarding".
      testIgnore: /onboarding[^/]*\.spec\.ts/,
      use: { baseURL: SEEDED_SERVER.url },
    },
    {
      // T26: a FRESH (unseeded) IndexedDB so boot lands on the disclaimer +
      // setup path — the only way to exercise the real onboarding happy path.
      // D-WF16: BOTH onboarding specs (form-view pin + worded default) run
      // against the fresh server.
      name: 'onboarding',
      testMatch: /onboarding[^/]*\.spec\.ts/,
      use: { baseURL: FRESH_SERVER.url },
    },
  ],
  webServer: E2E_SERVERS.map((s) => ({
    name: s.name,
    command: `npm run ${s.script}`,
    url: s.url,
    reuseExistingServer: REUSE,
    env: { CAIRN_DEV_NONCE: NONCE },
    // Cold start = vite + sql.js wasm fetch + 47 migrations + demo seed.
    timeout: 120_000,
  })),
});
