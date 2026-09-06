// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BASE_TIMEOUT_MS,
  HIGH_LOAD_TIMEOUT_MS,
  LOAD_POLICY_ENV,
  currentLoadPolicy,
  loadPolicy,
  loadSummaryLine,
  parseLoadPolicy,
  runLoadPolicy,
} from '../../e2e/load-guard';

const base = { cores: 10, ci: false, env: {} as Record<string, string> };

describe('loadPolicy (W-I D-I6/D-I7)', () => {
  it('normal load: Playwright defaults and one calm banner line', () => {
    const p = loadPolicy({ ...base, load1: 2.1 });
    expect(p).toMatchObject({
      enabled: true,
      high: false,
      refuse: false,
      workers: null,
      timeoutMs: BASE_TIMEOUT_MS,
    });
    expect(p.line).toBe('[e2e/load] 1-min load 2.1 on 10 cores (soft line 7.0) — normal parallelism.');
  });

  it('the recorded reproduction (load ≳ 9 on 10 cores) serializes and doubles the timeout — never skips', () => {
    const p = loadPolicy({ ...base, load1: 9.3 });
    expect(p).toMatchObject({ high: true, refuse: false, workers: 1, timeoutMs: HIGH_LOAD_TIMEOUT_MS });
    expect(p.line).toBe(
      '[e2e/load] 1-min load 9.3 on 10 cores is above the soft line 7.0 — running serialized (workers 1, timeout 120s). A timeout in this run is inconclusive until repeated below the line.',
    );
  });

  it('at the hard line locally it refuses (distinct report, nothing runs); on CI it only serializes (D-I7)', () => {
    const local = loadPolicy({ ...base, load1: 41 });
    expect(local.refuse).toBe(true);
    expect(local.line).toBe(
      '[e2e/load] 1-min load 41.0 on 10 cores is at or above the hard line 15.0 — refusing to run (a timeout here would say nothing about the code). Re-run below 7.0, or set E2E_LOAD_HARD / E2E_LOAD_GUARD=0.',
    );
    const ci = loadPolicy({ ...base, load1: 41, ci: true });
    expect(ci).toMatchObject({ refuse: false, high: true, workers: 1 });
  });

  it('thresholds: soft = 0.7×cores, hard = 1.5×cores; env overrides win; nonsense overrides fall back', () => {
    expect(loadPolicy({ ...base, load1: 0 })).toMatchObject({ soft: 7, hard: 15 });
    expect(loadPolicy({ ...base, load1: 0, cores: 2 })).toMatchObject({ soft: 2, hard: 3 }); // floors: soft ≥ 2, hard ≥ soft + 1
    expect(
      loadPolicy({ ...base, load1: 0, env: { E2E_LOAD_SOFT: '4', E2E_LOAD_HARD: '9' } }),
    ).toMatchObject({ soft: 4, hard: 9 });
    expect(
      loadPolicy({ ...base, load1: 0, env: { E2E_LOAD_SOFT: 'lots', E2E_LOAD_HARD: '-1' } }),
    ).toMatchObject({ soft: 7, hard: 15 });
  });

  it('E2E_LOAD_GUARD=0 disables everything and says so', () => {
    const p = loadPolicy({ ...base, load1: 41, env: { E2E_LOAD_GUARD: '0' } });
    expect(p).toMatchObject({
      enabled: false,
      high: false,
      refuse: false,
      workers: null,
      timeoutMs: BASE_TIMEOUT_MS,
    });
    expect(p.line).toBe('[e2e/load] guard disabled (E2E_LOAD_GUARD=0); 1-min load 41.0 on 10 cores.');
  });

  it('the SOFT boundary is strict, as S2 says ("is above the soft line"): at the line is normal, a hair over serializes', () => {
    expect(loadPolicy({ ...base, load1: 7 })).toMatchObject({
      high: false,
      workers: null,
      timeoutMs: BASE_TIMEOUT_MS,
    });
    expect(loadPolicy({ ...base, load1: 7.01 })).toMatchObject({
      high: true,
      workers: 1,
      timeoutMs: HIGH_LOAD_TIMEOUT_MS,
    });
    // and with an override, at the same boundary
    const env = { E2E_LOAD_SOFT: '4' };
    expect(loadPolicy({ ...base, load1: 4, env }).high).toBe(false);
    expect(loadPolicy({ ...base, load1: 4.01, env }).high).toBe(true);
  });

  it('the HARD boundary is inclusive, as S3 says ("at or above the hard line"): at the line it refuses', () => {
    expect(loadPolicy({ ...base, load1: 15 })).toMatchObject({ refuse: true, high: true });
    expect(loadPolicy({ ...base, load1: 14.99 }).refuse).toBe(false);
    const env = { E2E_LOAD_HARD: '9' };
    expect(loadPolicy({ ...base, load1: 9, env }).refuse).toBe(true);
    expect(loadPolicy({ ...base, load1: 8.99, env }).refuse).toBe(false);
  });

  it('is JSON-serializable (it travels through config.metadata to the reporter) and never asks for retries', () => {
    const p = loadPolicy({ ...base, load1: 9 });
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
    expect(Object.keys(p)).not.toContain('retries');
  });

  it('currentLoadPolicy reads this machine', () => {
    const p = currentLoadPolicy();
    expect(p.cores).toBeGreaterThan(0);
    expect(Number.isFinite(p.load1)).toBe(true);
  });
});

describe("loadSummaryLine (the reporter's one line — never the exit code)", () => {
  const high = loadPolicy({ ...base, load1: 9.3 });
  const normal = loadPolicy({ ...base, load1: 2 });

  it('a green run is one short line', () => {
    expect(
      loadSummaryLine({ policy: normal, status: 'passed', timedOut: 0, failed: 0, endLoad1: 2.4 }),
    ).toBe('[e2e/load] passed; 1-min load 2.0 → 2.4.');
  });

  it('timeouts under load are INCONCLUSIVE — and assertion failures are explicitly not excused', () => {
    const line = loadSummaryLine({
      policy: high,
      status: 'failed',
      timedOut: 7,
      failed: 1,
      endLoad1: 11.2,
    });
    expect(line).toBe(
      '[e2e/load] INCONCLUSIVE — 7 timeout(s) and 1 failure(s) with 1-min load 9.3 → 11.2 (soft line 7.0). Timeouts under load say nothing about the code; repeat below the line before reading them as regressions. Failures with an assertion message stand on their own.',
    );
  });

  it('timeouts below the line are called real', () => {
    expect(
      loadSummaryLine({ policy: normal, status: 'failed', timedOut: 2, failed: 0, endLoad1: 2.1 }),
    ).toBe(
      '[e2e/load] 2 timeout(s) and 0 failure(s) with 1-min load 2.0 → 2.1, below the soft line 7.0 — treat as real.',
    );
  });

  it('a DISABLED guard says so — it never claims the load was below a line it did not apply', () => {
    const off = loadPolicy({ ...base, load1: 41, env: { E2E_LOAD_GUARD: '0' } });
    expect(
      loadSummaryLine({ policy: off, status: 'failed', timedOut: 3, failed: 0, endLoad1: 40 }),
    ).toBe(
      '[e2e/load] guard disabled (E2E_LOAD_GUARD=0); 3 timeout(s) and 0 failure(s); 1-min load 41.0 → 40.0.',
    );
  });

  it('a run that started below the line and ROSE past it says that, instead of "treat as real"', () => {
    expect(
      loadSummaryLine({ policy: normal, status: 'failed', timedOut: 3, failed: 0, endLoad1: 30 }),
    ).toBe(
      '[e2e/load] 3 timeout(s) and 0 failure(s) with 1-min load 2.0 → 30.0 — the load rose past the soft line 7.0 during the run; repeat below the line before reading the timeouts as regressions.',
    );
    // exactly at the soft line is not "past" it (the soft boundary is strict)
    expect(
      loadSummaryLine({ policy: normal, status: 'failed', timedOut: 1, failed: 0, endLoad1: 7 }),
    ).toContain('below the soft line 7.0 — treat as real.');
  });

  it('failures without timeouts: load is not the story', () => {
    expect(
      loadSummaryLine({ policy: normal, status: 'failed', timedOut: 0, failed: 3, endLoad1: 2 }),
    ).toBe('[e2e/load] 3 failure(s), no timeouts; 1-min load 2.0 → 2.0 — load is not the story here.');
  });

  it('no policy in metadata (a foreign config) still yields a line', () => {
    expect(
      loadSummaryLine({ policy: null, status: 'failed', timedOut: 1, failed: 0, endLoad1: 3 }),
    ).toMatch(/1 timeout\(s\).*n\/a → 3\.0/);
  });

  it('every arm keeps the owner hard lines: no exclamation mark, never "you should"', () => {
    const lines = [
      normal.line,
      high.line,
      loadPolicy({ ...base, load1: 41 }).line,
      loadPolicy({ ...base, load1: 41, env: { E2E_LOAD_GUARD: '0' } }).line,
      loadSummaryLine({ policy: normal, status: 'passed', timedOut: 0, failed: 0, endLoad1: 2 }),
      loadSummaryLine({ policy: high, status: 'failed', timedOut: 1, failed: 1, endLoad1: 9 }),
      loadSummaryLine({ policy: normal, status: 'failed', timedOut: 1, failed: 0, endLoad1: 2 }),
      loadSummaryLine({ policy: normal, status: 'failed', timedOut: 0, failed: 1, endLoad1: 2 }),
      loadSummaryLine({ policy: normal, status: 'failed', timedOut: 1, failed: 0, endLoad1: 30 }),
      loadSummaryLine({
        policy: loadPolicy({ ...base, load1: 41, env: { E2E_LOAD_GUARD: '0' } }),
        status: 'failed',
        timedOut: 1,
        failed: 0,
        endLoad1: 40,
      }),
    ];
    for (const l of lines) {
      expect(l).not.toMatch(/!/);
      expect(l).not.toMatch(/you should/i);
    }
  });
});

describe('runLoadPolicy — ONE reading per run, inherited by every worker (MINOR 0)', () => {
  const mainPolicy = loadPolicy({ ...base, load1: 2.1 });

  it('the main process reads the machine once and freezes that reading into the env the workers inherit', () => {
    const env: Record<string, string | undefined> = {};
    let reads = 0;
    const policy = runLoadPolicy(env, () => {
      reads += 1;
      return mainPolicy;
    });
    expect(policy).toEqual(mainPolicy);
    expect(reads).toBe(1);
    expect(parseLoadPolicy(env[LOAD_POLICY_ENV])).toEqual(mainPolicy);
  });

  it('a WORKER inherits that policy and never takes its own loadavg (the banner and the timeout are the same run)', () => {
    const env: Record<string, string | undefined> = {
      TEST_WORKER_INDEX: '0',
      [LOAD_POLICY_ENV]: JSON.stringify(mainPolicy),
    };
    const inherited = runLoadPolicy(env, () => {
      throw new Error('a worker must not read the load itself');
    });
    expect(inherited).toEqual(mainPolicy);
    expect(inherited.timeoutMs).toBe(mainPolicy.timeoutMs);
    expect(inherited.line).toBe(mainPolicy.line);
  });

  it('a worker with no frozen policy (or a garbled one) falls back to its own reading rather than to nothing', () => {
    const own = loadPolicy({ ...base, load1: 5 });
    for (const raw of [undefined, 'not json', '{"line":"only a line"}', 'null']) {
      const env: Record<string, string | undefined> = { TEST_WORKER_INDEX: '3' };
      if (raw !== undefined) env[LOAD_POLICY_ENV] = raw;
      expect(runLoadPolicy(env, () => own), String(raw)).toEqual(own);
    }
  });

  it('parseLoadPolicy round-trips a whole policy and rejects anything partial', () => {
    const high = loadPolicy({ ...base, load1: 9.3 });
    expect(parseLoadPolicy(JSON.stringify(high))).toEqual(high);
    for (const raw of [
      undefined,
      '',
      '[]',
      'null',
      '{"enabled":true}',
      JSON.stringify({ ...high, line: 42 }),
      JSON.stringify({ ...high, workers: 'one' }),
    ]) {
      expect(parseLoadPolicy(raw), String(raw)).toBeNull();
    }
  });
});
