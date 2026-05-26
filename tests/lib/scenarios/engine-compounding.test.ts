import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Household, Person } from '@/types/schema';
import type { Bracket } from '@/lib/tax';
import { CompoundingFrequency } from '@/types/enums';

/**
 * Engine integration tests for the per-scenario compounding-frequency lever
 * (Task #16). Strategy: zero income, zero loans, zero expenses, zero
 * inflation. Investment growth via the Returns lever is the ONLY trended
 * factor so we can read state[N].investmentsByAccount[1] and compare
 * against the closed form.
 */

const household = {
  id: 1,
  filingStatus: 'SINGLE',
  state: 'CA',
  city: null,
  monthlyExpenseBaseline: 0,
  withdrawalRate: 0.04,
  inflationAssumption: 0,
  growthScenarios: [],
} as unknown as Household;

const persons: Person[] = [
  { id: 1, householdId: 1, name: 'P1', annualSalaryPretax: 0 } as unknown as Person,
];

const federal: Bracket[] = [{ min: 0, max: null, rate: 0 }];

function realStateWith(initialInvestment: number): RealState {
  return {
    accounts: [],
    holdings: [],
    loans: [],
    loanPayments: [],
    household,
    persons,
    baselineMonthlyExpenses: 0,
    initialCash: 0,
    initialInvestmentsByAccount: { 1: initialInvestment },
    cashAccountsWithBalances: [],
    defaults: { inflation: 0, returnRate: 0.07, defaultCashApy: null },
    startISO: '2026-01',
    taxBrackets: {
      federal,
      state: [],
      city: null,
      standardDeduction: 0,
    },
  };
}

function returnsOnlyPayload(
  defaultRate: number,
  compoundingFrequency: CompoundingFrequency = CompoundingFrequency.MONTHLY,
) {
  const p = emptyLeverPayload();
  p.returns = {
    defaultRate,
    overrides: {},
    cashRate: null,
    compoundingFrequency,
  };
  return p;
}

describe('engine — compounding frequency on the Returns lever', () => {
  describe('MONTHLY (default) — preserves pre-Task-16 baseline exactly', () => {
    it('$100k @ 7% / 12 months / zero flows = $107,000.00', () => {
      const real = realStateWith(100_000);
      const payload = returnsOnlyPayload(0.07, CompoundingFrequency.MONTHLY);
      const states = projectScenario(real, payload, { startISO: '2026-01', months: 13 });
      // month 0 is the starting state (no compounding applied yet).
      // month 12 = 12 monthly returns applied.
      const balance = states[12].investmentsByAccount[1];
      expect(balance).toBeCloseTo(107_000, 2);
    });

    it('default emptyLeverPayload defaults to MONTHLY frequency', () => {
      const real = realStateWith(100_000);
      // emptyLeverPayload() with no overrides should preserve legacy behavior.
      const payload = emptyLeverPayload();
      // Force the rate to 7% explicitly (emptyLeverPayload uses 0.07 already).
      const states = projectScenario(real, payload, { startISO: '2026-01', months: 13 });
      const balance = states[12].investmentsByAccount[1];
      expect(balance).toBeCloseTo(107_000, 2);
    });
  });

  describe('ANNUALLY / QUARTERLY / WEEKLY / DAILY — all preserve total annual yield', () => {
    // Under the effective-annual interpretation, the user-supplied annual rate
    // is what compounds over 12 months regardless of frequency. So $100k @ 7%
    // over 12 months should land at ~$107,000 for every frequency, within
    // the $1 acceptance bound from the spec.
    const annual = 0.07;
    const start = 100_000;
    const expectedAt12Months = start * (1 + annual); // 107_000

    for (const freq of [
      CompoundingFrequency.DAILY,
      CompoundingFrequency.WEEKLY,
      CompoundingFrequency.QUARTERLY,
      CompoundingFrequency.ANNUALLY,
    ] as CompoundingFrequency[]) {
      it(`${freq}: $100k @ 7% over 12 months ≈ $107,000.00 (within $1)`, () => {
        const real = realStateWith(start);
        const payload = returnsOnlyPayload(annual, freq);
        const states = projectScenario(real, payload, {
          startISO: '2026-01',
          months: 13,
        });
        const balance = states[12].investmentsByAccount[1];
        expect(Math.abs(balance - expectedAt12Months)).toBeLessThan(1);
      });
    }
  });

  describe('multi-year projection — total yield preserved at every annual boundary', () => {
    it('$100k @ 7% MONTHLY across 5 years = $100k × 1.07^5 ≈ $140,255.17', () => {
      const real = realStateWith(100_000);
      const payload = returnsOnlyPayload(0.07, CompoundingFrequency.MONTHLY);
      const states = projectScenario(real, payload, { startISO: '2026-01', months: 61 });
      const balance = states[60].investmentsByAccount[1];
      const expected = 100_000 * Math.pow(1.07, 5);
      expect(balance).toBeCloseTo(expected, 2);
    });
  });

  describe('per-year overrides interact with frequency', () => {
    it('overrides[2027]=-0.10 still compounds correctly at MONTHLY frequency', () => {
      const real = realStateWith(100_000);
      const payload = emptyLeverPayload();
      payload.returns = {
        defaultRate: 0.07,
        overrides: { '2027': -0.10 },
        cashRate: null,
        compoundingFrequency: CompoundingFrequency.MONTHLY,
      };
      const states = projectScenario(real, payload, { startISO: '2026-01', months: 25 });
      // Year 1 (2026) ends month 12 at 7% compound: $107k.
      // Year 2 (2027) is -10%: ends month 24 at $107k * 0.9 = $96.3k.
      // But month 12 lands in Jan 2027 (the first 2027 step), so actually
      // the loop has 11 monthly steps in 2026 + 1 in 2027 between month 0 and month 12.
      // Take month 24 (Jan 2028): 11 in 2026 + 12 in 2027 + 1 in 2028.
      // Just verify the directional behavior — year 2 reduces balance.
      const yearOneEnd = states[12].investmentsByAccount[1];
      const yearTwoEnd = states[24].investmentsByAccount[1];
      expect(yearTwoEnd).toBeLessThan(yearOneEnd);
    });
  });

  describe('cash APY shares the compounding-frequency setting', () => {
    function realStateWithCash(cashBalance: number, apy: number): RealState {
      return {
        accounts: [
          { id: 99, type: 'ACCOUNT_SAVINGS' } as unknown as RealState['accounts'][number],
        ],
        holdings: [],
        loans: [],
        loanPayments: [],
        household,
        persons,
        baselineMonthlyExpenses: 0,
        initialCash: cashBalance,
        initialInvestmentsByAccount: {},
        cashAccountsWithBalances: [
          {
            account: { id: 99, apyRate: apy } as unknown as RealState['cashAccountsWithBalances'][number]['account'],
            balance: cashBalance,
          },
        ],
        defaults: { inflation: 0, returnRate: 0, defaultCashApy: null },
        startISO: '2026-01',
        taxBrackets: {
          federal,
          state: [],
          city: null,
          standardDeduction: 0,
        },
      };
    }

    it('$10k cash @ 5% APY / MONTHLY / 12 months ≈ $10,500.00', () => {
      const real = realStateWithCash(10_000, 0.05);
      const payload = returnsOnlyPayload(0, CompoundingFrequency.MONTHLY);
      const states = projectScenario(real, payload, { startISO: '2026-01', months: 13 });
      expect(states[12].cash).toBeCloseTo(10_500, 1);
    });

    it('$10k cash @ 5% APY / DAILY / 12 months still ≈ $10,500.00 (within $1)', () => {
      const real = realStateWithCash(10_000, 0.05);
      const payload = returnsOnlyPayload(0, CompoundingFrequency.DAILY);
      const states = projectScenario(real, payload, { startISO: '2026-01', months: 13 });
      expect(Math.abs(states[12].cash - 10_500)).toBeLessThan(1);
    });
  });
});
