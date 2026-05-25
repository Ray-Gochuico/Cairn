import { describe, it, expect } from 'vitest';
import {
  evaluateCreateBudget,
  evaluateSection0Info,
} from '@/domain/roadmap/rules/budgetEssentials';
import type { RoadmapContext } from '@/types/roadmap';
import type { Household } from '@/types/schema';
import { FilingStatus } from '@/types/enums';

function makeHousehold(patch: Partial<Household> = {}): Household {
  return {
    id: 1,
    name: null,
    filingStatus: FilingStatus.SINGLE,
    state: 'CA',
    city: null,
    monthlyExpenseBaseline: 5000,
    withdrawalRate: 0.04,
    inflationAssumption: 0.03,
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
    ...patch,
  };
}

function makeContext(patch: Partial<Household> = {}): RoadmapContext {
  return {
    household: makeHousehold(patch),
    persons: [],
    accounts: [],
    loans: [],
    contributions: [],
    snapshots: [],
    overrides: new Map(),
    thresholds: { low: 5, high: 8 },
    taxYear: 2026,
    today: new Date('2026-05-23T12:00:00Z'),
  };
}

describe('evaluateCreateBudget', () => {
  it('returns done when monthly expense baseline is set', () => {
    const r = evaluateCreateBudget(makeContext({ monthlyExpenseBaseline: 4200 }));
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/\$4,200/);
  });

  it('returns active with CTA when baseline is zero', () => {
    const r = evaluateCreateBudget(makeContext({ monthlyExpenseBaseline: 0 }));
    expect(r.status).toBe('active');
    expect(r.cta?.href).toBe('/household');
  });
});

describe('evaluateSection0Info', () => {
  it('returns info status for each known Section 0 node', () => {
    const ids = [
      's0_pay_rent',
      's0_buy_food',
      's0_pay_essentials',
      's0_income_expenses',
      's0_pay_health_care',
      's0_min_debt_payments',
    ] as const;
    for (const id of ids) {
      const r = evaluateSection0Info(id)(makeContext());
      expect(r.status).toBe('info');
      expect(r.evidence).toBeTruthy();
    }
  });

  it('returns distinct guidance text per node', () => {
    const rent = evaluateSection0Info('s0_pay_rent')(makeContext());
    const food = evaluateSection0Info('s0_buy_food')(makeContext());
    expect(rent.evidence).not.toBe(food.evidence);
  });
});
