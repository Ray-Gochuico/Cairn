import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { captureRealState } from '@/lib/scenarios/state-snapshot';
import type { HousingPayment, VehicleLease, Household } from '@/types/schema';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';

/**
 * Engine integration tests for v1.1 recurring-obligations (rent + leases).
 *
 * Strategy: zero income, zero return, zero inflation, no expense periods —
 * the ONLY contribution to step.expenses comes from active housing + lease
 * rows. With monthISO advancing by 1 month each step, end-dated leases drop
 * out automatically once monthISO crosses the lease's endDate boundary.
 *
 * Start month is 2026-05 → step 0 anchors at that month with zeros; step 1
 * lands at 2026-06 (the first projected month).
 */

const household = {
  id: 1,
  filingStatus: 'SINGLE',
  state: 'CA',
  city: null,
  monthlyExpenseBaseline: 0,
  withdrawalRate: 0.04,
  inflationAssumption: 0.024,
  growthScenarios: [],
  disclaimerAcceptedAt: null,
  disclaimerVersionAccepted: null,
  roadmapDisclaimerAcceptedAt: null,
  roadmapDisclaimerVersionAccepted: null,
  interestThresholdLowPct: null,
  interestThresholdHighPct: null,
  hasWrittenIps: null,
  hasHsaQualifiedHdhp: null,
  makesCharitableGifts: null,
  upcomingLargePurchase: null,
  upcomingPurchaseAmount: null,
  upcomingPurchaseMonths: null,
} as unknown as Household;

function makeRealState(
  housingPayments: HousingPayment[],
  vehicleLeases: VehicleLease[],
) {
  return captureRealState({
    accounts: [],
    accountSnapshots: [],
    holdings: [],
    loans: [],
    loanPayments: [],
    transactions: [],
    household,
    persons: [],
    appSettings: {
      defaultInflation: 0, // disable inflation so we test raw delta
      defaultReturnRate: 0,
      defaultCashApy: null,
      defaultDrawdownTaxRate: null,
    },
    startISO: '2026-05',
    taxRules: [],
    housingPayments,
    vehicleLeases,
  });
}

function zeroEverythingPayload() {
  const p = emptyLeverPayload();
  p.returns = { defaultRate: 0, overrides: {}, cashRate: null };
  p.inflation = { defaultRate: 0, overrides: {} };
  // No expense periods — recurring obligations are the only expense source.
  p.expensePeriods = [];
  return p;
}

describe('engine — recurring obligations', () => {
  it('adds active rent + lease to monthly expenses', () => {
    const housing: HousingPayment[] = [
      {
        id: 1,
        householdId: 1,
        ownerPersonId: null,
        name: 'Apt',
        monthlyAmount: 2000,
        startDate: '2026-01-01',
        endDate: null,
      },
    ];
    const leases: VehicleLease[] = [
      {
        id: 1,
        householdId: 1,
        ownerPersonId: null,
        name: 'Tesla',
        monthlyAmount: 500,
        startDate: '2026-01-01',
        endDate: null,
      },
    ];

    const real = makeRealState(housing, leases);
    const states = projectScenario(real, zeroEverythingPayload(), {
      startISO: '2026-05',
      months: 2,
    });

    // Step 0 is the captured "today" anchor (no flows applied). Step 1 is
    // the first projected month (2026-06) — that's where housing+lease land.
    expect(states[1].expenses).toBeCloseTo(2500, 0);
  });

  it('drops a lease from expenses after its end date', () => {
    const housing: HousingPayment[] = [];
    const leases: VehicleLease[] = [
      {
        id: 1,
        householdId: 1,
        ownerPersonId: null,
        name: 'Short lease',
        monthlyAmount: 500,
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      },
    ];

    const real = makeRealState(housing, leases);
    const states = projectScenario(real, zeroEverythingPayload(), {
      startISO: '2026-05',
      months: 12,
    });

    // 2026-05 start; step 1 = 2026-06 (lease active),
    // step 2 = 2026-07 (lease ended).
    expect(states[1].expenses).toBeCloseTo(500, 0);
    expect(states[2].expenses).toBeCloseTo(0, 0);
  });

  it('is a no-op when both lists are empty', () => {
    const real = makeRealState([], []);
    const states = projectScenario(real, zeroEverythingPayload(), {
      startISO: '2026-05',
      months: 2,
    });
    expect(states[1].expenses).toBe(0);
  });
});
