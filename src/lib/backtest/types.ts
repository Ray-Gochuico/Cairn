export type OutcomeTier = 'met' | 'below' | 'depleted';

export type WithdrawalStrategyId = 'bengen' | 'constant-dollar' | 'variable';

export interface BacktestConfig {
  initialPortfolio: number;   // real $
  annualSpending: number;     // real $/yr (constant-dollar; ignored for bengen which derives from 0.04*initial)
  horizonYears: number;       // e.g. 30
  goalAmount: number;         // real $; 0 = pure survival
  strategy: WithdrawalStrategyId;
  stockPct: number;           // 0..1 (e.g. 0.75); bonds = 1 - stockPct
  // Variable-strategy guardrails (only consulted when strategy === 'variable'):
  variableRate: number;       // 0..1 fraction of CURRENT portfolio (e.g. 0.04)
  minWithdrawal: number;      // real $ floor
  maxWithdrawal: number;      // real $ ceiling
}

export interface StartYearOutcome {
  startYear: number;
  annualBalances: number[];   // real $, index 0 = initialPortfolio, length = horizonYears+1
  endingBalance: number;      // real $
  tier: OutcomeTier;
  depletedYear: number | null; // years-into-retirement when balance first hit 0, else null
}

export interface BacktestResult {
  outcomes: StartYearOutcome[];
  startYears: { first: number; last: number; count: number };
  goalMetCount: number;       // tier === 'met'
  survivedCount: number;      // tier === 'met' || 'below'
  tierCounts: { met: number; below: number; depleted: number };
  belowGoal: Array<{ startYear: number; endingBalance: number; tier: Exclude<OutcomeTier, 'met'> }>;
  endings: {
    worst: { value: number; startYear: number; depletedYear: number | null };
    median: number;
    best: { value: number; startYear: number };
  };
  percentilesByYear: { p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[] };
}
