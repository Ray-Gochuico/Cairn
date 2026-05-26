import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Holding, Loan, Household, Person } from '@/types/schema';
import type { Bracket } from '@/lib/tax';

// Regression: a saving household (income > expenses) must see net worth
// rise year-over-year, not decay. Previously the engine read `household.persons`,
// which does not exist on the Household schema — persons live in their own
// store — so monthly income silently collapsed to 0 and net worth decayed.

const holdings = [
  { id: 1, accountId: 1, ticker: 'VTI', shareCount: 100, costBasis: 200, targetAllocationPct: null },
] as unknown as Holding[];

const loans: Loan[] = [];

const household = {
  id: 1, filingStatus: 'SINGLE', state: 'CA', city: null,
  monthlyExpenseBaseline: 3000, withdrawalRate: 0.04,
  inflationAssumption: 0.025, growthScenarios: [],
} as unknown as Household;

const persons: Person[] = [
  { id: 1, householdId: 1, name: 'You', annualSalaryPretax: 120000 } as unknown as Person,
];

const federal2026Single: Bracket[] = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
];

const caSingle: Bracket[] = [
  { min: 0, max: 10412, rate: 0.01 },
  { min: 10412, max: 24684, rate: 0.02 },
];

const realState: RealState = {
  accounts: [], holdings, loans, loanPayments: [], household, persons,
  baselineMonthlyExpenses: 3000,
  initialCash: 0,
  initialInvestmentsByAccount: { 1: 20000 }, // 100 shares VTI @ $200 costBasis
  defaults: { inflation: 0.025, returnRate: 0.07 },
  startISO: '2026-05',
  taxBrackets: { federal: federal2026Single, state: caSingle, city: null, standardDeduction: 14600 },
};

describe('projectScenario — net worth growth for a saving household', () => {
  it('net worth rises year-over-year when income > expenses', () => {
    const states = projectScenario(realState, emptyLeverPayload(), { startISO: '2026-05', months: 60 });
    const year1 = states[12].netWorth;
    const year2 = states[24].netWorth;
    const year3 = states[36].netWorth;
    const year4 = states[48].netWorth;
    expect(year2).toBeGreaterThan(year1);
    expect(year3).toBeGreaterThan(year2);
    expect(year4).toBeGreaterThan(year3);
  });

  it('reads persons from RealState.persons, not household.persons', () => {
    // If engine still reads household.persons, this would produce 0 income.
    const states = projectScenario(realState, emptyLeverPayload(), { startISO: '2026-05', months: 13 });
    expect(states[6].incomeAfterTax).toBeGreaterThan(0);
  });

  it('default emptyLeverPayload holds salary steady (annualRaiseRate=0)', () => {
    // With no raises, monthly gross income should be ~identical year over year.
    // Bracket-real tax may shift slightly due to multi-bracket interactions, but
    // gross income (and thus pre-tax monthly income drag) should be the same.
    const states = projectScenario(realState, emptyLeverPayload(), { startISO: '2026-05', months: 36 });
    const monthA = states[6].incomeAfterTax;
    const monthB = states[18].incomeAfterTax;
    const monthC = states[30].incomeAfterTax;
    expect(monthB).toBeCloseTo(monthA, 0);
    expect(monthC).toBeCloseTo(monthA, 0);
  });
});
