import { randomUUID } from 'node:crypto';
import { defineConfig } from '@playwright/test';
import { runLoadPolicy } from './e2e/load-guard';
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

// W-I D-I6: the load policy, read ONCE per RUN — not once per process. The
// main process (no TEST_WORKER_INDEX, the same guard the nonce uses) takes the
// single os.loadavg() reading and freezes it into the env; every worker
// re-imports this file and inherits THAT policy, so the timeout a test gets is
// the timeout the banner announced. It travels to the reporter through
// `metadata`. The banner and the hard refusal print/throw only in the main
// process, BEFORE any server launches, so a refusal costs nothing and reads as
// one line, not as twenty timeouts.
const LOAD = runLoadPolicy(process.env);
if (!process.env.TEST_WORKER_INDEX) {
  // The refusal reads ONCE: Playwright prints the thrown error itself, so a
  // console.log ahead of it would print the same line twice.
  if (LOAD.refuse) throw new Error(LOAD.line);
  console.log(LOAD.line);
}

const REPORTERS: Array<[string] | [string, Record<string, unknown>]> = [['list']];
if (process.env.CI) REPORTERS.push(['html', { open: 'never' }]);
REPORTERS.push(['./e2e/load-reporter.ts']);

export default defineConfig({
  testDir: './e2e',
  timeout: LOAD.timeoutMs,
  ...(LOAD.workers !== null ? { workers: LOAD.workers } : {}),
  // Unchanged: one retry on CI only. The load policy adds NONE (D-I6).
  retries: process.env.CI ? 1 : 0,
  reporter: REPORTERS,
  globalSetup: './e2e/global-setup.ts',
  metadata: { loadPolicy: LOAD, reuseExistingServer: REUSE },
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
