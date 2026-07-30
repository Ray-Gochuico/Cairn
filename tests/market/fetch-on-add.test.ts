import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Database } from '@/db/db';

vi.mock('@/market/run-market-data-refresh', () => ({
  runMarketDataRefresh: vi.fn(),
}));

/**
 * W19 fetch-on-add: holding adds/edits/imports request a market-data refresh
 * through this coalescing entry point so a bulk row-by-row entry session
 * fires ONE refresh per burst window instead of N near-simultaneous ones
 * (Yahoo 429 hardening suggested by the diagnosis).
 *
 * Module state (the burst window) is reset via vi.resetModules() so each
 * case gets a fresh window — no test-only reset exports in production code.
 */
describe('fetchMarketDataOnAdd (burst-coalescing fetch-on-add)', () => {
  const db = {} as Database;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function load() {
    const { fetchMarketDataOnAdd } = await import('@/market/fetch-on-add');
    const { runMarketDataRefresh } = await import(
      '@/market/run-market-data-refresh'
    );
    // The vi.mock factory result survives vi.resetModules(); clear the call
    // log so each case starts from zero.
    vi.mocked(runMarketDataRefresh).mockClear();
    return { fetchMarketDataOnAdd, refresh: vi.mocked(runMarketDataRefresh) };
  }

  it('runs the refresh immediately on a lone add (leading edge)', async () => {
    const { fetchMarketDataOnAdd, refresh } = await load();
    fetchMarketDataOnAdd(db);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(db);
  });

  it('coalesces a burst of adds into one trailing refresh', async () => {
    const { fetchMarketDataOnAdd, refresh } = await load();
    fetchMarketDataOnAdd(db);
    vi.advanceTimersByTime(300);
    fetchMarketDataOnAdd(db);
    vi.advanceTimersByTime(300);
    fetchMarketDataOnAdd(db);
    // Leading run only so far.
    expect(refresh).toHaveBeenCalledTimes(1);
    // The trailing run fires once after the window — it picks up every
    // ticker added during the burst (they are read from holdings.listAll()).
    vi.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    // No further stragglers.
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('an add after the window runs immediately again', async () => {
    const { fetchMarketDataOnAdd, refresh } = await load();
    fetchMarketDataOnAdd(db);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    fetchMarketDataOnAdd(db);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
