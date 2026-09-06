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
  /** load1 ≥ soft → workers 1, longer timeout, banner. */
  high: boolean;
  /** load1 ≥ hard AND not CI → the config throws before any server launches. */
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
 */
export function loadPolicy(input: LoadPolicyInput): LoadPolicy {
  const { load1, cores, ci, env } = input;
  const enabled = env.E2E_LOAD_GUARD !== '0';
  const soft = positive(env.E2E_LOAD_SOFT, Math.max(2, cores * 0.7));
  const hard = positive(env.E2E_LOAD_HARD, Math.max(soft + 1, cores * 1.5));
  const high = enabled && load1 >= soft;
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

/** S9: the reporter's one line. Names timeouts vs failures with the load at start and end. */
export function loadSummaryLine(s: RunSummaryInput): string {
  const start = s.policy ? fmt(s.policy.load1) : 'n/a';
  const end = fmt(s.endLoad1);
  const soft = s.policy ? fmt(s.policy.soft) : 'n/a';
  if (s.status === 'passed') return `[e2e/load] passed; 1-min load ${start} → ${end}.`;
  if (s.timedOut > 0 && s.policy?.high) {
    return `[e2e/load] INCONCLUSIVE — ${s.timedOut} timeout(s) and ${s.failed} failure(s) with 1-min load ${start} → ${end} (soft line ${soft}). Timeouts under load say nothing about the code; repeat below the line before reading them as regressions. Failures with an assertion message stand on their own.`;
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
