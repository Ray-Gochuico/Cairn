import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload, type LeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Household, HousingPayment, Person, VehicleLease } from '@/types/schema';

// C2 review (UPHELD 0/1/2) — the engine stamps, per month, the share of that
// month's spending the scenario AUTHORED: its resolved expense base plus the
// expense periods the engine applies that month, the household's recurring
// obligations (rent, vehicle leases) EXCLUDED. Nominal, like every sibling
// dollar field: (base + periods) × the month's inflation factor. The FI gate
// (milestones.ts) and G11 read this stamp, so they judge a period exactly as
// the engine spends it — a mid-month start, a start today, a future start, a
// period that ends.

const household = {
  id: 1, filingStatus: 'SINGLE', state: 'TX', city: null,
  monthlyExpenseBaseline: 6_000, withdrawalRate: 0.04, inflationAssumption: 0.03, growthScenarios: [],
} as unknown as Household;
const persons: Person[] = [{ id: 1, householdId: 1, name: 'P1', annualSalaryPretax: 0 } as unknown as Person];

const RENT: HousingPayment = { id: 1, householdId: 1, ownerPersonId: null, name: 'Rent', monthlyAmount: 2_500, startDate: '2026-01-01', endDate: null };
const LEASE: VehicleLease = { id: 1, householdId: 1, ownerPersonId: null, name: 'Lease', monthlyAmount: 400, startDate: '2026-01-01', endDate: '2026-09-30' };

function real(over: { basis?: RealState['expenseBasis'] | undefined; housing?: HousingPayment[]; leases?: VehicleLease[]; inflation?: number } = {}): RealState {
  return {
    accounts: [], holdings: [], loans: [], loanPayments: [], household, persons,
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 1_000_000, initialInvestmentsByAccount: {}, cashAccountsWithBalances: [],
    defaults: { inflation: over.inflation ?? 0, returnRate: 0, defaultCashApy: null, defaultDrawdownTaxRate: null },
    startISO: '2026-07',
    taxBrackets: { federal: [], state: [], city: null, ltcg: [], standardDeduction: { federal: 0, state: 0, city: 0 } },
    housingPayments: over.housing ?? [], vehicleLeases: over.leases ?? [],
    expenseBasis: 'basis' in over ? over.basis : { latestMonth: 2_500, rolling12m: 3_000, rolling12mMonths: 3 },
  } as unknown as RealState;
}
const payload = (over: Partial<LeverPayload> = {}): LeverPayload => ({
  ...emptyLeverPayload(), expenseSource: 'custom', customMonthly: 0, ...over,
});
const project = (r: RealState, p: LeverPayload, months = 24) => projectScenario(r, p, { startISO: '2026-07', months });
const authored = (r: RealState, p: LeverPayload, months = 24) => project(r, p, months).map((s) => s.authoredExpenses);

describe('MonthlyState.authoredExpenses — the engine stamps the AUTHORED share of each month\'s spending', () => {
  it('month 0 is the seed (nothing is spent) → 0; every stepped month carries the stamp', () => {
    const states = project(real(), payload({ customMonthly: 2_000 }));
    expect(states[0].expenses).toBe(0);
    expect(states[0].authoredExpenses).toBe(0);
    for (const s of states.slice(1)) expect(s.authoredExpenses).toBe(2_000);
  });

  it('base + the periods active THAT month — a 12-month period adds, then ends; a period not yet started adds nothing', () => {
    const p = payload({ customMonthly: 2_000, expensePeriods: [{ start: '2026-08-01', monthlyDelta: 1_200, durationMonths: 12 }] });
    const a = authored(real(), p);
    expect(a[1]).toBe(3_200);   // 2026-08: started
    expect(a[12]).toBe(3_200);  // 2027-07: the period's 12th month
    expect(a[13]).toBe(2_000);  // 2027-08: ended
    const later = authored(real(), payload({ customMonthly: 2_000, expensePeriods: [{ start: '2027-01-01', monthlyDelta: 1_200, durationMonths: 12 }] }));
    expect(later[5]).toBe(2_000);  // 2026-12: not started
    expect(later[6]).toBe(3_200);  // 2027-01
  });

  it('a pre-Feature-B periods-only scenario (custom/0 + periods, no basis captured) is AUTHORED spending, never $0 (B5)', () => {
    const a = authored(real({ basis: undefined }), payload({ expensePeriods: [{ start: '2026-07-01', monthlyDelta: 1_200, durationMonths: 480 }] }));
    for (const v of a.slice(1)) expect(v).toBe(1_200);
  });

  it('the hazard shape: custom/0 with rent + a lease on file authors $0 in every month while the engine spends the obligations', () => {
    const states = project(real({ housing: [RENT], leases: [LEASE] }), payload());
    expect(states[1].expenses).toBe(2_900);          // 2026-08: rent + lease
    expect(states[4].expenses).toBe(2_500);          // 2026-11: the lease has ended
    for (const s of states) expect(s.authoredExpenses).toBe(0);
  });

  it('a data mode with nothing captured authors $0 too — the popover\'s guard, not a number, speaks for it', () => {
    const empty = { latestMonth: 0, rolling12m: 0, rolling12mMonths: 0 };
    for (const v of authored(real({ basis: empty, housing: [RENT] }), payload({ expenseSource: 'rolling12m' }))) expect(v).toBe(0);
    for (const v of authored(real({ basis: undefined }), payload({ expenseSource: 'rolling12m' }))) expect(v).toBe(0);
    // … and a captured one is authored: data modes read RealState.expenseBasis
    expect(authored(real(), payload({ expenseSource: 'rolling12m' }))[1]).toBe(3_000);
    expect(authored(real(), payload({ expenseSource: 'latestMonth' }))[1]).toBe(2_500);
  });

  it('judged exactly as the engine spends it: a start TODAY (mid-month, the "+ Add period" default) counts from the first stepped month, as a start on the 1st does', () => {
    const today = authored(real(), payload({ expensePeriods: [{ start: '2026-07-24', monthlyDelta: 5_000, durationMonths: 480 }] }));
    const first = authored(real(), payload({ expensePeriods: [{ start: '2026-07-01', monthlyDelta: 5_000, durationMonths: 480 }] }));
    expect(today).toEqual(first);
    expect(today[0]).toBe(0);
    expect(today[1]).toBe(5_000);
    // a mid-month start in a LATER month counts from the month after it, exactly like the engine's expenses
    const states = project(real(), payload({ expensePeriods: [{ start: '2026-10-15', monthlyDelta: 5_000, durationMonths: 480 }] }));
    expect(states.map((s) => s.authoredExpenses)).toEqual(states.map((s) => s.expenses));
    expect(states[3].authoredExpenses).toBe(0);      // 2026-10: the 15th start is not active on the 1st
    expect(states[4].authoredExpenses).toBe(5_000);  // 2026-11
  });

  it('nominal, like its siblings: (base + periods) × the month\'s inflation factor; expenses − authored = the obligations\' nominal share', () => {
    const r = real({ housing: [RENT], inflation: 0.03 });
    const states = project(r, payload({ customMonthly: 4_000, inflation: { defaultRate: 0.03, overrides: {} } }), 36);
    const noRent = project(real({ inflation: 0.03 }), payload({ customMonthly: 4_000, inflation: { defaultRate: 0.03, overrides: {} } }), 36);
    for (let i = 1; i < 36; i++) {
      expect(states[i].authoredExpenses).toBe(noRent[i].expenses);                 // the authored share IS the no-obligation spending
      const factor = noRent[i].expenses / 4_000;
      expect(states[i].expenses - states[i].authoredExpenses!).toBeCloseTo(2_500 * factor, 6);
    }
    expect(states[35].authoredExpenses!).toBeGreaterThan(states[1].authoredExpenses!); // inflation grew it
  });
});
