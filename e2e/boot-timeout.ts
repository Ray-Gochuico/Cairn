import { test } from '@playwright/test';
import { BASE_TIMEOUT_MS, HIGH_LOAD_TIMEOUT_MS, type LoadPolicy } from './load-guard';

/**
 * v1.7.1 A-6: ONE boot wait for every spec, read from the load policy the
 * config froze into `metadata` (D-I6: the policy a worker reads is the policy
 * the banner announced). Half the policy's test timeout in both arms — 30 s under
 * normal parallelism (the literal every spec carried before), 60 s serialized
 * — so a cold boot (vite + sql.js wasm + the migrations + the seed) scales
 * with the run's budget and can never consume all of it. It is the POLICY's
 * budget: a CLI `--timeout` overrides config.timeout, not the frozen policy, so
 * it does not move this wait (review I-m3; no house command passes one).
 *
 * A function, not a constant: `test.info()` is defined only while a test is
 * running ("test.info() can only be called while test is running"), so the
 * read happens at each call site, inside the test body. In-page waits keep
 * Playwright's 5 s default on purpose — this is the boot tier only.
 */
export const BOOT_TIMEOUT_SHARE = 0.5;
export const BOOT_TIMEOUT_MS = BASE_TIMEOUT_MS * BOOT_TIMEOUT_SHARE;
export const HIGH_LOAD_BOOT_TIMEOUT_MS = HIGH_LOAD_TIMEOUT_MS * BOOT_TIMEOUT_SHARE;

/** Pure: the policy (or none) → the boot wait. Total — a missing or malformed policy reads as the normal arm. */
export function bootTimeoutFor(policy: LoadPolicy | null | undefined): number {
  const budget = policy?.timeoutMs;
  return typeof budget === 'number' && Number.isFinite(budget) && budget > 0
    ? Math.round(budget * BOOT_TIMEOUT_SHARE)
    : BOOT_TIMEOUT_MS;
}

/** The boot wait for THIS test — the frozen policy in the run's config metadata (e2e/load-reporter.ts reads it the same way). */
export function bootTimeout(): number {
  const metadata = test.info().config.metadata as { loadPolicy?: LoadPolicy } | null | undefined;
  return bootTimeoutFor(metadata?.loadPolicy ?? null);
}
