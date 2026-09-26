// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BASE_TIMEOUT_MS, HIGH_LOAD_TIMEOUT_MS, loadPolicy } from '../../e2e/load-guard';
import {
  BOOT_TIMEOUT_MS,
  BOOT_TIMEOUT_SHARE,
  HIGH_LOAD_BOOT_TIMEOUT_MS,
  HIGH_LOAD_WEB_SERVER_TIMEOUT_MS,
  WEB_SERVER_TIMEOUT_MS,
  WEB_SERVER_TIMEOUT_SHARE,
  bootTimeout,
  bootTimeoutFor,
  webServerTimeoutFor,
} from '../../e2e/boot-timeout';

const base = { cores: 10, ci: false, env: {} as Record<string, string> };

// This file imports the REAL @playwright/test through e2e/boot-timeout.ts (no
// mock here, on purpose) — the mocked-runner arms live in boot-timeout-runtime.test.ts.
describe('bootTimeoutFor (v1.7.1 A-6) — one boot wait, half the test budget, from the frozen policy', () => {
  it('normal parallelism → 30 s, the literal every spec carried before the hoist (CR-I-2: nothing moves at the defaults)', () => {
    expect(bootTimeoutFor(loadPolicy({ ...base, load1: 2.1 }))).toBe(30_000);
    expect(BOOT_TIMEOUT_MS).toBe(30_000);
  });

  it('above the soft line (workers 1, test timeout 120 s) → 60 s', () => {
    expect(bootTimeoutFor(loadPolicy({ ...base, load1: 9.3 }))).toBe(60_000);
    expect(HIGH_LOAD_BOOT_TIMEOUT_MS).toBe(60_000);
  });

  it('the gate receipt arm: E2E_LOAD_SOFT=0.1 on a lightly loaded machine serializes → 60 s', () => {
    expect(bootTimeoutFor(loadPolicy({ ...base, load1: 0.5, env: { E2E_LOAD_SOFT: '0.1' } }))).toBe(60_000);
  });

  it('is total: guard disabled, no policy, or a malformed one → 30 s (a spec never waits on undefined)', () => {
    expect(bootTimeoutFor(loadPolicy({ ...base, load1: 41, env: { E2E_LOAD_GUARD: '0' } }))).toBe(30_000);
    expect(bootTimeoutFor(null)).toBe(30_000);
    expect(bootTimeoutFor(undefined)).toBe(30_000);
    expect(bootTimeoutFor({ timeoutMs: 0 } as never)).toBe(30_000);
    expect(bootTimeoutFor({ timeoutMs: Number.NaN } as never)).toBe(30_000);
  });

  it('is exactly half the test timeout in both arms, so one wait can never consume the whole test budget', () => {
    expect(BOOT_TIMEOUT_SHARE).toBe(0.5);
    expect(bootTimeoutFor(loadPolicy({ ...base, load1: 2 }))).toBe(BASE_TIMEOUT_MS * BOOT_TIMEOUT_SHARE);
    expect(bootTimeoutFor(loadPolicy({ ...base, load1: 9.3 }))).toBe(HIGH_LOAD_TIMEOUT_MS * BOOT_TIMEOUT_SHARE);
    for (const load1 of [0, 7, 7.01, 15]) {
      const p = loadPolicy({ ...base, load1 });
      expect(bootTimeoutFor(p)).toBeLessThan(p.timeoutMs);
    }
  });

  it("bootTimeout() is a FUNCTION because test.info() exists only while a test runs — outside one it throws Playwright's own message (the real import; the receipt P9 cites)", () => {
    expect(() => bootTimeout()).toThrow(/test\.info\(\) can only be called while test is running/);
  });
});

// v1.8.0 T12 (chip v171-12, Lane I leftover b; CR-T12-5): the dev servers' cold
// start (vite + sql.js wasm + the migrations + the seed) follows the SAME frozen
// policy, through the same budget reader as bootTimeoutFor.
describe('webServerTimeoutFor (v1.8.0 T12, I-(b)) — the cold-start budget follows the frozen policy', () => {
  it('normal parallelism → 120 s, the literal playwright.config.ts carried before (CR-T12-5: nothing moves at the defaults)', () => {
    expect(webServerTimeoutFor(loadPolicy({ ...base, load1: 2.1 }))).toBe(120_000);
    expect(WEB_SERVER_TIMEOUT_MS).toBe(120_000);
  });

  it('above the soft line (workers 1, test timeout 120 s) → 240 s', () => {
    expect(webServerTimeoutFor(loadPolicy({ ...base, load1: 9.3 }))).toBe(240_000);
    expect(HIGH_LOAD_WEB_SERVER_TIMEOUT_MS).toBe(240_000);
  });

  it('the gate receipt arm: E2E_LOAD_SOFT=0.1 on a lightly loaded machine serializes → 240 s', () => {
    expect(webServerTimeoutFor(loadPolicy({ ...base, load1: 0.5, env: { E2E_LOAD_SOFT: '0.1' } }))).toBe(240_000);
  });

  it('is total: guard disabled, no policy, or a malformed one → 120 s (a server never waits on undefined)', () => {
    expect(webServerTimeoutFor(loadPolicy({ ...base, load1: 41, env: { E2E_LOAD_GUARD: '0' } }))).toBe(120_000);
    expect(webServerTimeoutFor(null)).toBe(120_000);
    expect(webServerTimeoutFor(undefined)).toBe(120_000);
    expect(webServerTimeoutFor({ timeoutMs: 0 } as never)).toBe(120_000);
    expect(webServerTimeoutFor({ timeoutMs: Number.NaN } as never)).toBe(120_000);
  });

  it('is exactly twice the test timeout in both arms, and the three waits keep their order: boot < test < cold start', () => {
    expect(WEB_SERVER_TIMEOUT_SHARE).toBe(2);
    expect(webServerTimeoutFor(loadPolicy({ ...base, load1: 2 }))).toBe(BASE_TIMEOUT_MS * WEB_SERVER_TIMEOUT_SHARE);
    expect(webServerTimeoutFor(loadPolicy({ ...base, load1: 9.3 }))).toBe(HIGH_LOAD_TIMEOUT_MS * WEB_SERVER_TIMEOUT_SHARE);
    for (const load1 of [0, 7, 7.01, 15]) {
      const p = loadPolicy({ ...base, load1 });
      expect(bootTimeoutFor(p)).toBeLessThan(p.timeoutMs);
      expect(p.timeoutMs).toBeLessThan(webServerTimeoutFor(p));
    }
  });

  // T12 code review (CR-T12-5): both waits read the policy's BUDGET through one
  // reader, not its arm. A budget that matches neither default (90 s) tells that
  // apart from the rejected `high ? 240 s : 120 s` design, which answers 120 s
  // (or 240 s) here and passed every other arm.
  it('follows the budget itself, not the arm: a 90 s budget gives a 45 s boot wait and a 180 s cold start', () => {
    expect(bootTimeoutFor({ timeoutMs: 90_000 } as never)).toBe(45_000); //       round(90 000 × 0.5)
    expect(webServerTimeoutFor({ timeoutMs: 90_000 } as never)).toBe(180_000); // round(90 000 × 2)
    expect(webServerTimeoutFor({ timeoutMs: 90_000, high: true } as never)).toBe(180_000);
    expect(bootTimeoutFor({ timeoutMs: 90_000, high: true } as never)).toBe(45_000);
  });
});
