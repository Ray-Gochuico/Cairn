// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { loadPolicy } from '../../e2e/load-guard';
import { bootTimeout } from '../../e2e/boot-timeout';

// vi.mock is hoisted above the imports; the mutable holder must be hoisted too.
const runner = vi.hoisted(() => ({ metadata: undefined as unknown }));
vi.mock('@playwright/test', () => ({
  test: { info: () => ({ config: { metadata: runner.metadata } }) },
}));

const base = { cores: 10, ci: false, env: {} as Record<string, string> };

describe('bootTimeout() (v1.7.1 A-6) — reads the FROZEN policy from test.info().config.metadata.loadPolicy', () => {
  it('serialized arm in the metadata → 60 s (M10: a bootTimeout that ignores the metadata answers 30 s here)', () => {
    runner.metadata = { loadPolicy: loadPolicy({ ...base, load1: 9.3 }) };
    expect(bootTimeout()).toBe(60_000);
  });

  it('normal arm in the metadata → 30 s', () => {
    runner.metadata = { loadPolicy: loadPolicy({ ...base, load1: 2 }) };
    expect(bootTimeout()).toBe(30_000);
  });

  it('no policy in the metadata ({} or null) → 30 s, never undefined', () => {
    runner.metadata = {};
    expect(bootTimeout()).toBe(30_000);
    runner.metadata = null;
    expect(bootTimeout()).toBe(30_000);
  });
});
