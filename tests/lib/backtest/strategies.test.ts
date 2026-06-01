import { describe, it, expect } from 'vitest';
import { withdrawalForYear } from '@/lib/backtest/strategies';
import type { BacktestConfig } from '@/lib/backtest/types';

const base: BacktestConfig = {
  initialPortfolio: 1_500_000,
  annualSpending: 60_000,
  horizonYears: 30,
  goalAmount: 0,
  strategy: 'constant-dollar',
  stockPct: 0.75,
  variableRate: 0.04,
  minWithdrawal: 48_000,
  maxWithdrawal: 90_000,
};

describe('withdrawalForYear — constant-dollar', () => {
  it('draws the same real amount every year regardless of balance', () => {
    const cfg = { ...base, strategy: 'constant-dollar' as const };
    expect(withdrawalForYear(cfg, 0, cfg.initialPortfolio)).toBe(60_000);
    expect(withdrawalForYear(cfg, 15, 4_000_000)).toBe(60_000);
    expect(withdrawalForYear(cfg, 29, 100_000)).toBe(60_000);
  });
});

describe('withdrawalForYear — bengen', () => {
  it('draws 4% of the INITIAL portfolio, constant-real thereafter', () => {
    const cfg = { ...base, strategy: 'bengen' as const };
    const expected = 0.04 * cfg.initialPortfolio; // 60_000
    expect(withdrawalForYear(cfg, 0, cfg.initialPortfolio)).toBe(expected);
    expect(withdrawalForYear(cfg, 20, 9_000_000)).toBe(expected); // does NOT flex with balance
  });
});

describe('withdrawalForYear — variable with guardrails', () => {
  const cfg = { ...base, strategy: 'variable' as const };

  it('year 0 draws rate * initialPortfolio when inside the band', () => {
    // 0.04 * 1.5M = 60_000, within [48k, 90k]
    expect(withdrawalForYear(cfg, 0, cfg.initialPortfolio)).toBe(60_000);
  });

  it('flexes with the prior-year balance', () => {
    // 0.04 * 2_000_000 = 80_000, within band
    expect(withdrawalForYear(cfg, 5, 2_000_000)).toBe(80_000);
  });

  it('clamps UP to the floor in a down year', () => {
    // 0.04 * 1_000_000 = 40_000 < 48_000 floor
    expect(withdrawalForYear(cfg, 5, 1_000_000)).toBe(48_000);
  });

  it('clamps DOWN to the ceiling in a boom year', () => {
    // 0.04 * 3_000_000 = 120_000 > 90_000 ceiling
    expect(withdrawalForYear(cfg, 5, 3_000_000)).toBe(90_000);
  });
});
