/**
 * T6 Fix-3: Verify domain math is exported from @/lib/debt-payoff (not the card).
 * The card re-exports nothing after the refactor; consumers import from the lib.
 */
import { describe, it, expect } from 'vitest';
import {
  pickStrategyTargetIndex,
  projectionsFor,
  type Strategy,
} from '@/lib/debt-payoff';
import { LoanType } from '@/types/enums';
import type { Loan } from '@/types/schema';

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 1,
    householdId: 1,
    obligorPersonId: null,
    name: 'Loan',
    type: LoanType.PERSONAL,
    originalAmount: 10000,
    currentBalance: 10000,
    interestRate: 0.06,
    termMonths: 60,
    firstPaymentDate: '2026-01-01',
    monthlyPayment: 0,
    extraPaymentDefault: 0,
    linkedPropertyId: null,
    linkedVehicleId: null,
    ...overrides,
  };
}

describe('pickStrategyTargetIndex (from @/lib/debt-payoff)', () => {
  const loans: Loan[] = [
    makeLoan({ id: 1, currentBalance: 5000, interestRate: 0.05 }),
    makeLoan({ id: 2, currentBalance: 20000, interestRate: 0.18 }),
    makeLoan({ id: 3, currentBalance: 1000, interestRate: 0.10 }),
  ];

  it('returns -1 for strategy "none"', () => {
    expect(pickStrategyTargetIndex(loans, 'none')).toBe(-1);
  });

  it('snowball returns the index of the smallest-balance loan', () => {
    expect(pickStrategyTargetIndex(loans, 'snowball')).toBe(2);
  });

  it('avalanche returns the index of the highest-rate loan', () => {
    expect(pickStrategyTargetIndex(loans, 'avalanche')).toBe(1);
  });
});

describe('projectionsFor (from @/lib/debt-payoff)', () => {
  const loans: Loan[] = [
    makeLoan({ id: 1, name: 'Low rate', currentBalance: 10000, interestRate: 0.05, termMonths: 60 }),
    makeLoan({ id: 2, name: 'High rate', currentBalance: 10000, interestRate: 0.18, termMonths: 60 }),
  ];

  it('returns one projection per loan', () => {
    expect(projectionsFor(loans, 'none', 0)).toHaveLength(2);
  });

  it('applies the extra payment only to the avalanche target', () => {
    const result = projectionsFor(loans, 'avalanche', 500);
    expect(result[0].extraApplied).toBe(0);
    expect(result[1].extraApplied).toBe(500);
  });

  it('Strategy type is "none" | "snowball" | "avalanche"', () => {
    const s: Strategy = 'avalanche';
    expect(['none', 'snowball', 'avalanche']).toContain(s);
  });
});
