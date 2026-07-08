import { describe, it, expect } from 'vitest';
import { makeHousehold } from './factories';
import { FilingStatus } from '@/types/enums';

describe('makeHousehold (wave-7 W6 — consolidates 19 local copies)', () => {
  it('builds a schema-valid household with the canonical defaults', () => {
    const h = makeHousehold();
    expect(h.id).toBe(1);
    expect(h.filingStatus).toBe(FilingStatus.SINGLE);
    expect(h.state).toBe('CA');
    expect(h.monthlyExpenseBaseline).toBe(5000);
    expect(h.withdrawalRate).toBe(0.04);
    expect(h.inflationAssumption).toBe(0.03);
    expect(h.growthScenarios).toEqual([]);
    // The eight roadmap-answer fields resolve through HouseholdSchema's
    // .default(null) — the factory omits them per the factories convention.
    expect(h.hasHsaQualifiedHdhp).toBeNull();
    expect(h.upcomingPurchaseMonths).toBeNull();
  });

  it('merges overrides and rejects schema-invalid ones loudly', () => {
    expect(makeHousehold({ inflationAssumption: 0.024 }).inflationAssumption).toBe(0.024);
    expect(makeHousehold({ hasWrittenIps: true }).hasWrittenIps).toBe(true);
    expect(() => makeHousehold({ withdrawalRate: 2 })).toThrow(); // z max(1)
  });
});
