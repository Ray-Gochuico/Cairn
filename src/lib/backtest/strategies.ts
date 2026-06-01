import type { BacktestConfig } from './types';

/**
 * The real-dollar withdrawal for a given year of a single backtest path.
 *
 * @param cfg                  the backtest configuration
 * @param yearIndex            0-based year into retirement (0 = first year)
 * @param priorYearEndBalance  the portfolio's real balance at the END of the
 *                             previous year (for yearIndex 0, pass
 *                             cfg.initialPortfolio)
 *
 * - constant-dollar: cfg.annualSpending, every year (constant in real terms).
 * - bengen:          0.04 * cfg.initialPortfolio, fixed at year 0, constant-real.
 * - variable:        clamp(cfg.variableRate * priorYearEndBalance,
 *                          cfg.minWithdrawal, cfg.maxWithdrawal).
 */
export function withdrawalForYear(
  cfg: BacktestConfig,
  _yearIndex: number,
  priorYearEndBalance: number,
): number {
  switch (cfg.strategy) {
    case 'constant-dollar':
      return cfg.annualSpending;
    case 'bengen':
      return 0.04 * cfg.initialPortfolio;
    case 'variable': {
      const raw = cfg.variableRate * priorYearEndBalance;
      return Math.min(cfg.maxWithdrawal, Math.max(cfg.minWithdrawal, raw));
    }
  }
}
