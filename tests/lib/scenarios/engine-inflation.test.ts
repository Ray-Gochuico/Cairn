import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Household, Person } from '@/types/schema';
import type { Bracket } from '@/lib/tax';

/**
 * Engine integration tests for the per-scenario inflation lever (Task #15).
 *
 * Strategy: zero income, zero return, zero loans, $1k baseline monthly
 * expenses. Inflation is the ONLY trended factor. The test reads
 * states[N].expenses and compares against the closed-form
 * (1 + inflation)^(N / 12) * 1000.
 */

const household = {
  id: 1,
  filingStatus: 'SINGLE',
  state: 'CA',
  city: null,
  monthlyExpenseBaseline: 1000,
  withdrawalRate: 0.04,
  inflationAssumption: 0.025,
  growthScenarios: [],
} as unknown as Household;

const persons: Person[] = [
  { id: 1, householdId: 1, name: 'P1', annualSalaryPretax: 0 } as unknown as Person,
];

const federal: Bracket[] = [
  { min: 0, max: null, rate: 0 },
];

function realStateWithSettingsInflation(settingsInflation: number): RealState {
  return {
    accounts: [],
    holdings: [],
    loans: [],
    loanPayments: [],
    household,
    persons,
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 0,
    initialInvestmentsByAccount: { 1: 1_000_000 }, // big bag to absorb the negative-savings drag
    cashAccountsWithBalances: [],
    defaults: { inflation: settingsInflation, returnRate: 0, defaultCashApy: null },
    startISO: '2026-01',
    taxBrackets: {
      federal,
      state: [],
      city: null,
      standardDeduction: { federal: 0, state: 0, city: 0 },
    },
  };
}

function zeroReturnPayloadWithInflation(
  defaultRate: number | null,
  overrides: Record<string, number> = {},
) {
  const p = emptyLeverPayload();
  p.returns = { defaultRate: 0, overrides: {}, cashRate: null };
  p.inflation = { defaultRate, overrides };
  // Replaces the pre-revamp `baselineMonthlyExpenses: 1000` factory field.
  // One long-duration $1000/mo expense period gives the engine the same
  // pre-inflation expense scalar to compound against.
  p.expensePeriods = [{ start: '2026-01-01', monthlyDelta: 1000, durationMonths: 480 }];
  return p;
}

describe('engine — inflation lever applies to expenses', () => {
  it('no per-scenario override: uses real.defaults.inflation (settings fallback) — preserves pre-Task-15 behavior', () => {
    const real = realStateWithSettingsInflation(0.03);
    const payload = zeroReturnPayloadWithInflation(null);
    const states = projectScenario(real, payload, { startISO: '2026-01', months: 145 });
    // Year 12 = monthIndex 144 = startISO + 12y (Jan 2026 → Jan 2038).
    // 144 monthly compounds at the 3% annual rate.
    const expectedFactor = Math.pow(1 + 0.03, 12);
    expect(states[144].expenses).toBeCloseTo(1000 * expectedFactor, 2);
  });

  it('per-scenario defaultRate 5% gives higher year-12 expenses than the 3% settings fallback', () => {
    const real = realStateWithSettingsInflation(0.03);
    // Same engine, two payloads. Scenario default 5% overrides the settings 3%.
    const base = projectScenario(real, zeroReturnPayloadWithInflation(null), {
      startISO: '2026-01',
      months: 145,
    });
    const override = projectScenario(real, zeroReturnPayloadWithInflation(0.05), {
      startISO: '2026-01',
      months: 145,
    });
    expect(override[144].expenses).toBeGreaterThan(base[144].expenses);
    // Match closed form: 1000 * 1.05^12.
    expect(override[144].expenses).toBeCloseTo(1000 * Math.pow(1.05, 12), 2);
  });

  it('per-year override "kinks" the curve at that year only — earlier years unchanged', () => {
    const real = realStateWithSettingsInflation(0.03);
    // Scenario default 3%, but calendar year 2031 (year 5) gets a 20% inflation spike.
    const payload = zeroReturnPayloadWithInflation(0.03, { '2031': 0.20 });
    const states = projectScenario(real, payload, { startISO: '2026-01', months: 85 });

    // Engine semantics: inflation applies per CALENDAR YEAR. With startISO=2026-01:
    //   state[N] = the result of N monthly compound steps from Jan 2026.
    //   step 1 = Feb 2026 (rate 2026), ..., step 11 = Dec 2026, step 12 = Jan 2027 (rate 2027).
    //   In a 12-step chunk, 11 steps land in the start-year and 1 step lands in the next year.
    //   For startMonth=Jan, this means a "5-year projection horizon" overshoots into year 5 by 1 month.

    // Year 4 anchor (Dec 2029, monthIndex=47): 47 monthly compounds. 11 in 2026
    // + 12 in 2027 + 12 in 2028 + 12 in 2029 = 47, all at 3%.
    // factor = (1.03^(1/12))^47 = 1.03^(47/12)
    expect(states[47].expenses).toBeCloseTo(1000 * Math.pow(1.03, 47 / 12), 2);

    // Just BEFORE 2031 spike: Dec 2030 = monthIndex 59. 59 months all at 3%.
    expect(states[59].expenses).toBeCloseTo(1000 * Math.pow(1.03, 59 / 12), 2);

    // First month of the spike: Jan 2031 = monthIndex 60. 59 at 3% + 1 at 20%.
    expect(states[60].expenses).toBeCloseTo(
      1000 * Math.pow(1.03, 59 / 12) * Math.pow(1.20, 1 / 12),
      2,
    );

    // Last month of the spike: Dec 2031 = monthIndex 71. 59 at 3% + 12 at 20%.
    expect(states[71].expenses).toBeCloseTo(
      1000 * Math.pow(1.03, 59 / 12) * 1.20,
      2,
    );

    // Back to default: Jan 2032 = monthIndex 72. 59 at 3% + 12 at 20% + 1 at 3% (2032).
    expect(states[72].expenses).toBeCloseTo(
      1000 * Math.pow(1.03, 59 / 12) * 1.20 * Math.pow(1.03, 1 / 12),
      2,
    );

    // One year after the spike: Dec 2032 = monthIndex 83. 59 at 3% + 12 at 20% + 12 at 3%.
    expect(states[83].expenses).toBeCloseTo(
      1000 * Math.pow(1.03, 59 / 12) * 1.20 * 1.03,
      2,
    );
  });

  it('zero inflation override produces flat expenses across the horizon (months >= 1)', () => {
    const real = realStateWithSettingsInflation(0.03);
    // Override settings 3% with scenario 0%.
    const payload = zeroReturnPayloadWithInflation(0);
    const states = projectScenario(real, payload, { startISO: '2026-01', months: 60 });
    // states[0] is the initial snapshot BEFORE any step ran — expenses is 0.
    // (Engine sets initial state with no expenses field computation.)
    expect(states[0].expenses).toBe(0);
    // Every subsequent month: baseline $1000, no period delta, no compounding.
    expect(states[12].expenses).toBeCloseTo(1000, 2);
    expect(states[59].expenses).toBeCloseTo(1000, 2);
  });

  it('negative per-year override (deflation) reduces expenses below the previous year', () => {
    const real = realStateWithSettingsInflation(0.03);
    const payload = zeroReturnPayloadWithInflation(0.03, { '2027': -0.02 });
    const states = projectScenario(real, payload, { startISO: '2026-01', months: 36 });
    // Dec 2027 (monthIndex=23): 11 at 3% (Feb..Dec 2026) + 12 at -2% (Jan..Dec 2027)
    expect(states[23].expenses).toBeCloseTo(1000 * Math.pow(1.03, 11 / 12) * 0.98, 2);
    // Dec 2028 (monthIndex=35): + 12 at 3% (Jan..Dec 2028)
    expect(states[35].expenses).toBeCloseTo(
      1000 * Math.pow(1.03, 11 / 12) * 0.98 * 1.03,
      2,
    );
  });
});
