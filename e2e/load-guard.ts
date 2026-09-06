import os from 'node:os';

export const BASE_TIMEOUT_MS = 60_000;
export const HIGH_LOAD_TIMEOUT_MS = 120_000;

export interface LoadEnv {
  E2E_LOAD_GUARD?: string;
  E2E_LOAD_SOFT?: string;
  E2E_LOAD_HARD?: string;
}

export interface LoadPolicyInput {
  load1: number;
  cores: number;
  ci: boolean;
  env: LoadEnv;
}

export interface LoadPolicy {
  enabled: boolean;
  load1: number;
  cores: number;
  soft: number;
  hard: number;
  /** load1 > soft → workers 1, longer timeout, banner. STRICT: S2 reads "is above the soft line". */
  high: boolean;
  /** load1 ≥ hard AND not CI → the config throws before any server launches. INCLUSIVE: S3 reads "at or above the hard line". */
  refuse: boolean;
  /** 1 under load; null = Playwright's default (half the cores). */
  workers: number | null;
  timeoutMs: number;
  /** S1–S4: the banner line. */
  line: string;
}

const fmt = (n: number) => n.toFixed(1);

function positive(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * W-I D-I6: pure. Soft line 0.7 × cores (the recorded "≳ 9 on 10 cores"
 * reproduction lands above it), hard line 1.5 × cores (the recorded "load 41"
 * lands above it). No retries anywhere: a retried timeout is relabelled
 * "flaky" and the run passes — that would mask, not report.
 *
 * The two boundaries say what they do: the soft line is STRICT (S2: "is above
 * the soft line") and the hard line is INCLUSIVE (S3: "at or above the hard
 * line"). Both edges are pinned in tests/e2e-harness/load-guard.test.ts.
 */
export function loadPolicy(input: LoadPolicyInput): LoadPolicy {
  const { load1, cores, ci, env } = input;
  const enabled = env.E2E_LOAD_GUARD !== '0';
  const soft = positive(env.E2E_LOAD_SOFT, Math.max(2, cores * 0.7));
  const hard = positive(env.E2E_LOAD_HARD, Math.max(soft + 1, cores * 1.5));
  const high = enabled && load1 > soft;
  const refuse = enabled && !ci && load1 >= hard;
  const where = `1-min load ${fmt(load1)} on ${cores} cores`;
  const line = !enabled
    ? `[e2e/load] guard disabled (E2E_LOAD_GUARD=0); ${where}.`
    : refuse
      ? `[e2e/load] ${where} is at or above the hard line ${fmt(hard)} — refusing to run (a timeout here would say nothing about the code). Re-run below ${fmt(soft)}, or set E2E_LOAD_HARD / E2E_LOAD_GUARD=0.`
      : high
        ? `[e2e/load] ${where} is above the soft line ${fmt(soft)} — running serialized (workers 1, timeout ${HIGH_LOAD_TIMEOUT_MS / 1000}s). A timeout in this run is inconclusive until repeated below the line.`
        : `[e2e/load] ${where} (soft line ${fmt(soft)}) — normal parallelism.`;
  return {
    enabled,
    load1,
    cores,
    soft,
    hard,
    high,
    refuse,
    workers: high ? 1 : null,
    timeoutMs: high ? HIGH_LOAD_TIMEOUT_MS : BASE_TIMEOUT_MS,
    line,
  };
}

export interface RunSummaryInput {
  policy: LoadPolicy | null;
  status: 'passed' | 'failed' | 'timedout' | 'interrupted';
  timedOut: number;
  failed: number;
  endLoad1: number;
}

/**
 * S9: the reporter's one line. Names timeouts vs failures with the load at
 * start and end.
 *
 * Every arm states only what is true of THIS run: a disabled guard says so
 * rather than borrowing the "below the soft line" wording of a line it never
 * applied, and a run that started below the line and rose past it says that
 * instead of calling its timeouts real (MINOR 1). Nothing here is ever excused
 * — the wording changes, the counts and the exit code do not.
 */
export function loadSummaryLine(s: RunSummaryInput): string {
  const start = s.policy ? fmt(s.policy.load1) : 'n/a';
  const end = fmt(s.endLoad1);
  const soft = s.policy ? fmt(s.policy.soft) : 'n/a';
  if (s.status === 'passed') return `[e2e/load] passed; 1-min load ${start} → ${end}.`;
  if (s.policy && !s.policy.enabled) {
    return `[e2e/load] guard disabled (E2E_LOAD_GUARD=0); ${s.timedOut} timeout(s) and ${s.failed} failure(s); 1-min load ${start} → ${end}.`;
  }
  if (s.timedOut > 0 && s.policy?.high) {
    return `[e2e/load] INCONCLUSIVE — ${s.timedOut} timeout(s) and ${s.failed} failure(s) with 1-min load ${start} → ${end} (soft line ${soft}). Timeouts under load say nothing about the code; repeat below the line before reading them as regressions. Failures with an assertion message stand on their own.`;
  }
  if (s.timedOut > 0 && s.policy && s.endLoad1 > s.policy.soft) {
    return `[e2e/load] ${s.timedOut} timeout(s) and ${s.failed} failure(s) with 1-min load ${start} → ${end} — the load rose past the soft line ${soft} during the run; repeat below the line before reading the timeouts as regressions.`;
  }
  if (s.timedOut > 0) {
    return `[e2e/load] ${s.timedOut} timeout(s) and ${s.failed} failure(s) with 1-min load ${start} → ${end}, below the soft line ${soft} — treat as real.`;
  }
  return `[e2e/load] ${s.failed} failure(s), no timeouts; 1-min load ${start} → ${end} — load is not the story here.`;
}

export function readLoad(): { load1: number; cores: number } {
  return { load1: os.loadavg()[0], cores: Math.max(1, os.cpus().length) };
}

export function currentLoadPolicy(): LoadPolicy {
  return loadPolicy({ ...readLoad(), ci: !!process.env.CI, env: process.env });
}

/** The env key the main process freezes its ONE reading into, for the workers to inherit. */
export const LOAD_POLICY_ENV = 'CAIRN_LOAD_POLICY';

/** A run's env as far as the load policy is concerned (process.env satisfies it). */
export type LoadRunEnv = Record<string, string | undefined>;

/** Read back a frozen policy. Anything absent, garbled or partial reads as null. */
export function parseLoadPolicy(raw: string | undefined): LoadPolicy | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  const numbers = ['load1', 'cores', 'soft', 'hard', 'timeoutMs'] as const;
  const booleans = ['enabled', 'high', 'refuse'] as const;
  const shaped =
    numbers.every((k) => typeof p[k] === 'number') &&
    booleans.every((k) => typeof p[k] === 'boolean') &&
    typeof p.line === 'string' &&
    (p.workers === null || typeof p.workers === 'number');
  return shaped ? (parsed as unknown as LoadPolicy) : null;
}

/**
 * D-I6 + MINOR 0: ONE reading per RUN, not one per process. Playwright workers
 * re-import playwright.config.ts (common/index.js `deserializeConfig` →
 * `loadConfig` → `requireOrImport`) and take `timeout` from THAT evaluation, so
 * a bare currentLoadPolicy() there samples os.loadavg() again at worker-spawn
 * time: a run whose banner announced "normal parallelism, 60s" could hand a
 * later worker 120s, or vice versa. The main process (no TEST_WORKER_INDEX —
 * the same guard that mints the nonce) reads the machine once and freezes the
 * policy into the env the workers inherit; a worker reads that and never the
 * load. A worker whose env carries nothing usable falls back to its own
 * reading — degraded, but never policy-less.
 */
export function runLoadPolicy(
  env: LoadRunEnv,
  fresh: () => LoadPolicy = currentLoadPolicy,
): LoadPolicy {
  if (env.TEST_WORKER_INDEX !== undefined) {
    const inherited = parseLoadPolicy(env[LOAD_POLICY_ENV]);
    if (inherited) return inherited;
  }
  const policy = fresh();
  env[LOAD_POLICY_ENV] = JSON.stringify(policy);
  return policy;
}
