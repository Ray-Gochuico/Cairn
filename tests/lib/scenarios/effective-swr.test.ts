import { describe, expect, it } from 'vitest';
import { effectiveSwr } from '@/lib/scenarios/effective-swr';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { Household } from '@/types/schema';
import type { Scenario } from '@/types/scenario';
import { makeHousehold as makeBaseHousehold } from '../../factories';

// Deliberately allows a schema-INVALID household: effectiveSwr must tolerate
// a runtime household whose withdrawalRate is missing/null, and
// HouseholdSchema.parse would reject null — so the null is spread on AFTER
// the parse. Everything else delegates to the shared factory.
const makeHousehold = (rate: number | null): Household =>
  ({
    ...makeBaseHousehold({
      monthlyExpenseBaseline: 4000,
      inflationAssumption: 0.025,
      growthScenarios: [{ label: 'Moderate', rate: 0.07 }],
    }),
    withdrawalRate: rate,
  }) as Household;

function makeScenario(swrOverride: number | null): Scenario {
  return {
    id: 1,
    name: 'Test',
    color: '#000',
    visible: true,
    isActive: true,
    isBaseline: false,
    leverPayload: { ...emptyLeverPayload(), swrOverride },
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  } as Scenario;
}

describe('effectiveSwr', () => {
  it('returns scenario override when set', () => {
    expect(effectiveSwr(makeScenario(0.035), makeHousehold(0.04))).toBe(0.035);
  });

  it('falls back to household.withdrawalRate when override is null', () => {
    expect(effectiveSwr(makeScenario(null), makeHousehold(0.045))).toBe(0.045);
  });

  it('falls back to 0.04 when both null/missing', () => {
    expect(effectiveSwr(null, null)).toBe(0.04);
  });

  it('falls back to 0.04 when household.withdrawalRate is 0', () => {
    expect(effectiveSwr(makeScenario(null), makeHousehold(0))).toBe(0.04);
  });

  it('falls back to household value when scenario is null', () => {
    expect(effectiveSwr(null, makeHousehold(0.05))).toBe(0.05);
  });
});
