import { describe, it, expect } from 'vitest';
import { compareStrategies } from '@/lib/debt-payoff-comparison';
import { projectionsFor } from '@/lib/debt-payoff';
import { LoanType } from '@/types/enums';
import type { Loan } from '@/types/schema';

const TODAY = '2026-05-14';

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

// Divergent targets: snowball picks the SMALL cheap loan, avalanche the BIG
// costly one — the strategies genuinely differ for this pair.
const twoLoans = () => [
  makeLoan({ id: 1, name: 'Cheap', currentBalance: 8000, interestRate: 0.03, termMonths: 120 }),
  makeLoan({ id: 2, name: 'Costly', currentBalance: 20000, interestRate: 0.07, termMonths: 120 }),
];

describe('compareStrategies (Wave 18 D11)', () => {
  it('single loan: both strategies are identical', () => {
    const c = compareStrategies([makeLoan()], 200, TODAY);
    expect(c.identical).toBe(true);
    expect(c.avalanche.totalInterest).toBe(c.snowball.totalInterest);
    expect(c.avalanche.payoffDate).toBe(c.snowball.payoffDate);
    expect(c.interestDelta).toBe(0);
    expect(c.monthsDelta).toBe(0);
  });

  it('two loans at a positive extra: avalanche interest ≤ snowball interest; delta ≥ 0', () => {
    const c = compareStrategies(twoLoans(), 200, TODAY);
    expect(c.identical).toBe(false);
    expect(c.avalanche.totalInterest).toBeLessThanOrEqual(c.snowball.totalInterest);
    expect(c.interestDelta).toBeCloseTo(
      c.snowball.totalInterest - c.avalanche.totalInterest,
      6,
    );
    expect(c.interestDelta).toBeGreaterThanOrEqual(0);
    expect(typeof c.monthsDelta).toBe('number');
  });

  it('outcomes reuse projectionsFor exactly (per-strategy parity)', () => {
    const loans = twoLoans();
    const c = compareStrategies(loans, 200, TODAY);
    const av = projectionsFor(loans, 'avalanche', 200, TODAY);
    expect(c.avalanche.totalInterest).toBeCloseTo(
      av.reduce((a, p) => a + p.amortization.totalInterest, 0),
      6,
    );
    const lastDates = av
      .map((p) => p.amortization.schedule[p.amortization.schedule.length - 1]?.paymentDate)
      .filter((d): d is string => Boolean(d));
    expect(c.avalanche.payoffDate).toBe(
      lastDates.reduce((latest, d) => (d > latest ? d : latest)),
    );
  });

  it('savedVsMinimums differences against the all-minimums baseline (positive with a default extra)', () => {
    const loans = [
      makeLoan({ id: 1, currentBalance: 30000, interestRate: 0.06, termMonths: 120, extraPaymentDefault: 250 }),
    ];
    const c = compareStrategies(loans, 0, TODAY);
    expect(c.avalanche.savedVsMinimums).toBeGreaterThan(0);
    expect(c.baselineInterest).toBeGreaterThan(c.avalanche.totalInterest);
  });

  it('a capped loan poisons both outcomes identically under contract payments (never rescued by either)', () => {
    const loans = [
      makeLoan({
        id: 9,
        name: 'Underwater',
        currentBalance: 300000,
        interestRate: 0.06,
        termMonths: 360,
        monthlyPayment: 1000, // < $1,500/mo interest → never amortizes
        firstPaymentDate: '2020-01-01',
      }),
      makeLoan({ id: 2, name: 'Healthy', currentBalance: 300500, interestRate: 0.05, termMonths: 60 }),
    ];
    // Extra 0: neither strategy rescues; capped-ness is a property of the
    // contract payment, so the two outcomes agree.
    const c = compareStrategies(loans, 0, TODAY);
    expect(c.avalanche.anyCapped).toBe(true);
    expect(c.snowball.anyCapped).toBe(c.avalanche.anyCapped);
    expect(c.monthsDelta).toBeNull();
    expect(c.avalanche.savingsCapped).toBe(true);
    expect(c.baselineCappedNames).toContain('Underwater');
  });

  it('rescued baseline (F1): the projection amortizes but savings stays poisoned', () => {
    const loans = [
      makeLoan({
        id: 9,
        name: 'Rescued',
        currentBalance: 300000,
        interestRate: 0.06,
        termMonths: 360,
        monthlyPayment: 1000,
        extraPaymentDefault: 600, // nets $100+/mo of principal — amortizes
        firstPaymentDate: '2020-01-01',
      }),
    ];
    const c = compareStrategies(loans, 0, TODAY);
    expect(c.avalanche.anyCapped).toBe(false);
    expect(c.avalanche.savingsCapped).toBe(true);
    expect(c.baselineCappedNames).toEqual(['Rescued']);
  });

  it('monthsDelta is whole months between the two payoff dates (positive = avalanche sooner)', () => {
    const c = compareStrategies(twoLoans(), 500, TODAY);
    if (c.avalanche.payoffDate && c.snowball.payoffDate && c.monthsDelta != null) {
      const [ay, am] = [
        Number(c.avalanche.payoffDate.slice(0, 4)),
        Number(c.avalanche.payoffDate.slice(5, 7)),
      ];
      const [sy, sm] = [
        Number(c.snowball.payoffDate.slice(0, 4)),
        Number(c.snowball.payoffDate.slice(5, 7)),
      ];
      expect(c.monthsDelta).toBe((sy - ay) * 12 + (sm - am));
    } else {
      throw new Error('expected computable dates for the uncapped fixture');
    }
  });
});
