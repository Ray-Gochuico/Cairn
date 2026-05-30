import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';
import { useHouseholdTaxContext } from '@/lib/calculators/use-household-tax-context';

const federal = [{ min: 0, max: null, rate: 0.2 }];
const state = [{ min: 0, max: null, rate: 0.05 }];

beforeEach(() => {
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
  useTaxRulesStore.setState({ year: null, items: [], isLoading: false, error: null });
});

function prime(year = 2026) {
  useHouseholdStore.setState({
    household: { filingStatus: FilingStatus.SINGLE, state: 'CA', city: null, monthlyExpenseBaseline: 0, withdrawalRate: 0.04, inflationAssumption: 0.03, growthScenarios: [] },
    isLoading: false, error: null,
  });
  usePersonsStore.setState({
    persons: [{ id: 1, householdId: 1, name: 'A', dateOfBirth: '1990-01-01', targetRetirementAge: 65, annualSalaryPretax: 100000, expectedBonus: 0, expectedBonusFrequency: 'ANNUAL', bonusIsConsistent: true, expectedCommission: 0, expectedCommissionFrequency: 'MONTHLY', employmentType: 'SALARY_NO_OT', hourlyRate: null, regularHoursPerWeek: 40, pretax401kPct: 0, healthInsuranceMonthlyPremium: 0, dependentCareFsaMonthly: 0, hsaMonthlyContribution: 0, hsaEligible: false }],
    isLoading: false, error: null,
  });
  useTaxRulesStore.setState({
    year, items: [
      { id: 1, year, jurisdictionType: 'FEDERAL', jurisdictionCode: 'US', filingStatus: FilingStatus.SINGLE, brackets: federal, standardDeduction: 15000 },
      { id: 2, year, jurisdictionType: 'STATE', jurisdictionCode: 'CA', filingStatus: FilingStatus.SINGLE, brackets: state, standardDeduction: 0 },
    ], isLoading: false, error: null,
  });
}

describe('useHouseholdTaxContext', () => {
  it('reports not-ready when stores are empty', () => {
    const { result } = renderHook(() => useHouseholdTaxContext());
    expect(result.current.ready).toBe(false);
    expect(result.current.federal).toBeNull();
  });

  it('resolves the most-recent seeded year and looks up federal/state', () => {
    prime(2026);
    const { result } = renderHook(() => useHouseholdTaxContext());
    expect(result.current.ready).toBe(true);
    expect(result.current.resolvedYear).toBe(2026);
    expect(result.current.federal?.standardDeduction).toBe(15000);
    expect(result.current.state?.jurisdictionCode).toBe('CA');
    expect(result.current.city).toBeNull();
  });

  it('falls back to the most-recent year when the calendar year is unseeded (stale-year path)', () => {
    prime(2025);
    const { result } = renderHook(() => useHouseholdTaxContext());
    expect(result.current.resolvedYear).toBe(2025);
    expect(result.current.federal).not.toBeNull();
  });

  it('exposes the all-persons aggregate', () => {
    prime(2026);
    const { result } = renderHook(() => useHouseholdTaxContext());
    expect(result.current.totalSalary).toBe(100000);
    expect(result.current.aggregatedPretax.pretax401k).toBe(0);
  });
});
