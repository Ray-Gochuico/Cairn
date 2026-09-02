import { beforeEach, describe, expect, it, vi } from 'vitest';

const load = vi.fn();
vi.mock('@/db/tauri-adapter', () => ({
  TauriAdapter: { load: (...a: unknown[]) => load(...a) },
}));
const runMigrations = vi.fn();
const loadAllMigrations = vi.fn().mockResolvedValue([]);
vi.mock('@/db/migrations', () => ({
  runMigrations: (...a: unknown[]) => runMigrations(...a),
  loadAllMigrations: (...a: unknown[]) => loadAllMigrations(...a),
}));
const assertDatabaseIntegrity = vi.fn();
vi.mock('@/db/integrity', () => ({
  assertDatabaseIntegrity: (...a: unknown[]) => assertDatabaseIntegrity(...a),
}));
const resetSampleDb = vi.fn();
vi.mock('@/db/sample-reset', () => ({
  resetSampleDb: (...a: unknown[]) => resetSampleDb(...a),
}));
const seedSampleProfile = vi.fn();
vi.mock('@/domain/sample-profile/sample-profile', () => ({
  seedSampleProfile: (...a: unknown[]) => seedSampleProfile(...a),
}));
// SettingsRepo.get is the first act of maybeRunLaunchRefresh — its silence
// proves the launch refresh never ran (the function lives in the module under
// test and can't be self-mocked).
const settingsGet = vi.fn();
vi.mock('@/domain/app-settings', () => ({
  SettingsRepo: class {
    get = settingsGet;
    update = vi.fn();
  },
}));
vi.mock('@/market/run-market-data-refresh', () => ({
  runMarketDataRefresh: vi.fn(),
}));

import { initDatabase } from '@/db/init';
import { EXPLORE_FLAG_KEY } from '@/lib/explore-mode';
import { INTERVIEW_BAR_KEY } from '@/lib/interview/bar-store';

/** The flag's VALUE is opaque to isExploreMode() — only presence matters —
 * so a fixed literal keeps this suite off the real clock (test-clock policy). */
const FLAG_SET_AT = '2026-07-08T12:00:00.000Z';

describe('initDatabase — explore branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(EXPLORE_FLAG_KEY);
    sessionStorage.clear();
    const fakeAdapter = {
      select: vi.fn().mockResolvedValue([{ n: 1 }]),
      execute: vi.fn(),
      close: vi.fn(),
    };
    load.mockResolvedValue(fakeAdapter);
    settingsGet.mockResolvedValue({ refreshCadence: 'MANUAL', lastRefreshAt: null });
  });

  it('with the flag set: wipes FIRST, opens ONLY the sample URL, seeds, and never touches the launch refresh', async () => {
    localStorage.setItem(EXPLORE_FLAG_KEY, FLAG_SET_AT);
    const order: string[] = [];
    resetSampleDb.mockImplementation(async () => void order.push('reset'));
    load.mockImplementation(async () => {
      order.push('load');
      return { select: vi.fn(), execute: vi.fn(), close: vi.fn() };
    });
    await initDatabase();
    expect(order).toEqual(['reset', 'load']); // delete-before-open (Windows file locks)
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('sqlite:sample-explore.db');
    // THE isolation pin: the real URL never appears anywhere in the boot.
    expect(load).not.toHaveBeenCalledWith('sqlite:finance.db');
    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(seedSampleProfile).toHaveBeenCalledTimes(1);
    expect(settingsGet).not.toHaveBeenCalled(); // maybeRunLaunchRefresh skipped (D-S7)
  });

  // W4 review (MINOR 0/4/18): a failing explore boot used to STRAND the user.
  // The flag survived, so every relaunch re-entered the same failing branch,
  // the banner (the only exit control) never mounted, and a Tauri user cannot
  // reach WKWebView's localStorage to clear the flag by hand.
  it('a failing explore boot clears the flag (and its prefs) so the NEXT boot is the real profile', async () => {
    localStorage.setItem(EXPLORE_FLAG_KEY, FLAG_SET_AT);
    localStorage.setItem('explore.donut.assets.hidden', '["account:2"]');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    load.mockRejectedValueOnce(new Error('sample-explore.db is locked'));

    await expect(initDatabase()).rejects.toThrow('sample-explore.db is locked');

    expect(localStorage.getItem(EXPLORE_FLAG_KEY)).toBeNull();
    expect(localStorage.getItem('explore.donut.assets.hidden')).toBeNull();
    expect(warn).toHaveBeenCalled(); // warn, never console.error (e2e console guard)
    warn.mockRestore();
  });

  // Coordinator ruling (2026-09-02, W4 smoke follow-up): the boot-failure path
  // leaves explore the same way the exit does, so it owes the same guarantee —
  // including the sessionStorage wipe that covers raw keys the namespace
  // ratchet cannot reach (frozen modules, e.g. the $X bar's session store).
  it('a failing explore boot wipes sessionStorage too — raw keys from frozen modules do not survive', async () => {
    localStorage.setItem(EXPLORE_FLAG_KEY, FLAG_SET_AT);
    sessionStorage.setItem(INTERVIEW_BAR_KEY, '{"amountCents":25000,"cadence":"per-month"}');
    sessionStorage.setItem('explore.calc-basis:calculators', 'future');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    load.mockRejectedValueOnce(new Error('sample-explore.db is locked'));

    await expect(initDatabase()).rejects.toThrow('sample-explore.db is locked');

    expect(sessionStorage.getItem(INTERVIEW_BAR_KEY)).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem(EXPLORE_FLAG_KEY)).toBeNull();
    warn.mockRestore();
  });

  it('a failing explore boot never falls through to the REAL database', async () => {
    localStorage.setItem(EXPLORE_FLAG_KEY, FLAG_SET_AT);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resetSampleDb.mockRejectedValueOnce(new Error('could not delete'));

    await expect(initDatabase()).rejects.toThrow('could not delete');

    expect(load).not.toHaveBeenCalled(); // no URL was opened at all
    warn.mockRestore();
  });

  it('without the flag: the existing path — real URL, no wipe, no sample seed, launch refresh consulted', async () => {
    await initDatabase();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('sqlite:finance.db');
    expect(resetSampleDb).not.toHaveBeenCalled();
    expect(seedSampleProfile).not.toHaveBeenCalled();
    expect(settingsGet).toHaveBeenCalled(); // maybeRunLaunchRefresh ran
  });
});
