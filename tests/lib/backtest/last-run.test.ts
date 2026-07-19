import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  readLastBacktestRun,
  writeLastBacktestRun,
  type BacktestLastRun,
} from '@/lib/backtest/last-run';

const KEY = 'backtest:last-run:v1';

const record: BacktestLastRun = {
  v: 1,
  runAt: '2026-07-18T15:00:00.000Z',
  goalMetCount: 108,
  startYearsCount: 124,
  survivedCount: 120,
  config: { initialPortfolio: 1_500_000, annualSpending: 60_000 },
};

describe('backtest last-run persistence (D3)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('round-trips a record through localStorage under the versioned key', () => {
    writeLastBacktestRun(record);
    expect(localStorage.getItem(KEY)).not.toBeNull();
    expect(readLastBacktestRun()).toEqual(record);
  });

  it('returns null when nothing is stored', () => {
    expect(readLastBacktestRun()).toBeNull();
  });

  it('malformed JSON reads as null (fail-soft)', () => {
    localStorage.setItem(KEY, '{not json');
    expect(readLastBacktestRun()).toBeNull();
  });

  it('a version mismatch reads as null', () => {
    localStorage.setItem(KEY, JSON.stringify({ ...record, v: 2 }));
    expect(readLastBacktestRun()).toBeNull();
  });

  it('a shape violation (negative count) reads as null', () => {
    localStorage.setItem(KEY, JSON.stringify({ ...record, goalMetCount: -1 }));
    expect(readLastBacktestRun()).toBeNull();
  });

  it('storage errors are swallowed on write (never throws)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => writeLastBacktestRun(record)).not.toThrow();
  });

  it('storage errors are swallowed on read (returns null)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readLastBacktestRun()).toBeNull();
  });
});
