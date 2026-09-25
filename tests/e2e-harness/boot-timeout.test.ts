// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BASE_TIMEOUT_MS, HIGH_LOAD_TIMEOUT_MS, loadPolicy } from '../../e2e/load-guard';
import {
  BOOT_TIMEOUT_MS,
  BOOT_TIMEOUT_SHARE,
  HIGH_LOAD_BOOT_TIMEOUT_MS,
  bootTimeout,
  bootTimeoutFor,
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
