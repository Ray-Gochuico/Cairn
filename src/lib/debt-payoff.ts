/**
 * Pure domain math for the DebtPayoff calculator. React-free; mirrors the
 * established lib boundary (coast-fi / amortization / overtime / backtest
 * all live in src/lib/).
 *
 * Re-exported by DebtPayoffCard.tsx; imported directly by tests and any
 * future consumers.
 */
import { amortize, type Amortization } from '@/lib/amortization';
import type { Loan } from '@/types/schema';

export type Strategy = 'none' | 'snowball' | 'avalanche';

export interface LoanProjection {
  loan: Loan;
  amortization: Amortization;
  /** Computed extra-payment that was applied for this loan (default + strategy share). */
  extraApplied: number;
}

/**
 * Pick the index of the loan that should receive the global "extra" payment
 * for a given strategy. Snowball: smallest balance first. Avalanche: highest
 * rate first. Returns -1 when there's nothing to target.
 *
 * v1 limitation: a SINGLE loan receives the entire extra each month. We do
 * NOT model the "snowball cascade" where, after the targeted loan is paid
 * off, the freed-up payment rolls onto the next loan in priority order.
 * Adding a true cascade requires a coupled month-by-month simulation across
 * all loans (the per-loan amortize() runs are independent today). Future
 * iteration.
 */
export function pickStrategyTargetIndex(loans: Loan[], strategy: Strategy): number {
  if (loans.length === 0) return -1;
  if (strategy === 'none') return -1;
  let bestIdx = 0;
  for (let i = 1; i < loans.length; i++) {
    if (strategy === 'snowball') {
      if (loans[i].currentBalance < loans[bestIdx].currentBalance) bestIdx = i;
    } else {
      // avalanche
      if (loans[i].interestRate > loans[bestIdx].interestRate) bestIdx = i;
    }
  }
  return bestIdx;
}

export function projectionsFor(
  loans: Loan[],
  strategy: Strategy,
  extraTotal: number,
): LoanProjection[] {
  const targetIdx = pickStrategyTargetIndex(loans, strategy);
  return loans.map((loan, i) => {
    const strategyExtra =
      strategy !== 'none' && i === targetIdx ? Math.max(0, extraTotal) : 0;
    const extraApplied = loan.extraPaymentDefault + strategyExtra;
    const amortization = amortize({
      principal: loan.currentBalance,
      annualRatePct: loan.interestRate,
      termMonths: loan.termMonths,
      firstPaymentDate: loan.firstPaymentDate,
      extraPayment: extraApplied,
    });
    return { loan, amortization, extraApplied };
  });
}
