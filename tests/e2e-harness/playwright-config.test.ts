// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPolicy, type LoadPolicy } from '../../e2e/load-guard';

// v1.8.0 T12 (chip v171-12, Lane I leftover b; CR-T12-5): the WIRING pin.
// webServerTimeoutFor is pinned pure in boot-timeout.test.ts; this file proves
// playwright.config.ts hands the run's ONE frozen policy to it. The config reads
// its policy through runLoadPolicy (e2e/load-guard.ts), so that one export is
// replaced with a chosen policy and everything else in load-guard stays real.
const frozen = vi.hoisted(() => ({ policy: undefined as unknown }));
vi.mock('../../e2e/load-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../e2e/load-guard')>()),
  runLoadPolicy: () => frozen.policy,
}));

const base = { cores: 10, ci: false, env: {} as Record<string, string> };

interface WebServerEntry {
  name?: string;
  timeout?: number;
}

/** Evaluate playwright.config.ts afresh under `policy` (the module reads it at load time). */
async function configUnder(policy: LoadPolicy): Promise<{ timeout?: number; webServer?: WebServerEntry[] }> {
  frozen.policy = policy;
  vi.resetModules();
  return (await import('../../playwright.config')).default as { timeout?: number; webServer?: WebServerEntry[] };
}

// The config mints CAIRN_DEV_NONCE into process.env in the main process and
// prints the policy's banner; both are put back / silenced around each load.
let nonceBefore: string | undefined;
beforeEach(() => {
  nonceBefore = process.env.CAIRN_DEV_NONCE;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  if (nonceBefore === undefined) delete process.env.CAIRN_DEV_NONCE;
  else process.env.CAIRN_DEV_NONCE = nonceBefore;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("playwright.config.ts — the dev servers' cold-start timeout follows the frozen load policy (v1.8.0 T12, I-(b))", () => {
  it('serialized policy → every webServer waits 240 s (M-T12-5: the old `timeout: 120_000` literal answers 120 s here)', async () => {
    const config = await configUnder(loadPolicy({ ...base, load1: 9.3 }));
    expect(config.webServer?.map((s) => s.timeout)).toEqual([240_000, 240_000]);
    expect(config.timeout).toBe(120_000);
  });

  it('normal policy → every webServer waits 120 s, the value it carried before (CR-T12-5: the defaults do not move)', async () => {
    const config = await configUnder(loadPolicy({ ...base, load1: 2 }));
    expect(config.webServer?.map((s) => s.timeout)).toEqual([120_000, 120_000]);
    expect(config.timeout).toBe(60_000);
  });
});
