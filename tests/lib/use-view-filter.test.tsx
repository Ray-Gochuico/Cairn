import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { usePersonsStore } from '@/stores/persons-store';
import { useViewFilter } from '@/lib/use-view-filter';
import type { Person } from '@/types/schema';

// Minimal person stubs — only need enough fields for the store
const p1: Person = {
  id: 1,
  householdId: 1,
  name: 'Alice',
  dateOfBirth: '1990-01-01',
  targetRetirementAge: 65,
  annualSalaryPretax: 100000,
  expectedBonus: 0,
  expectedBonusFrequency: 'ANNUAL',
  bonusIsConsistent: true,
  expectedCommission: 0,
  expectedCommissionFrequency: 'MONTHLY',
  employmentType: 'SALARY_NO_OT',
  hourlyRate: null,
  regularHoursPerWeek: 40,
  otThresholdHoursPerWeek: null,
  pretax401kPct: 0,
  healthInsuranceMonthlyPremium: 0,
  dependentCareFsaMonthly: 0,
  hsaMonthlyContribution: 0,
  hsaEligible: false,
};

const p2: Person = {
  id: 2,
  householdId: 1,
  name: 'Bob',
  dateOfBirth: '1992-01-01',
  targetRetirementAge: 65,
  annualSalaryPretax: 80000,
  expectedBonus: 0,
  expectedBonusFrequency: 'ANNUAL',
  bonusIsConsistent: true,
  expectedCommission: 0,
  expectedCommissionFrequency: 'MONTHLY',
  employmentType: 'SALARY_NO_OT',
  hourlyRate: null,
  regularHoursPerWeek: 40,
  otThresholdHoursPerWeek: null,
  pretax401kPct: 0,
  healthInsuranceMonthlyPremium: 0,
  dependentCareFsaMonthly: 0,
  hsaMonthlyContribution: 0,
  hsaEligible: false,
};

function wrapper(initialEntries: string[] = ['/dashboard']) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  );
}

beforeEach(() => {
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
});

describe('useViewFilter', () => {
  it('returns filter: household and isAvailable: false when persons.length === 1', () => {
    usePersonsStore.setState({ persons: [p1], isLoading: false, error: null });

    const { result } = renderHook(() => useViewFilter(), { wrapper: wrapper() });

    expect(result.current.filter).toBe('household');
    expect(result.current.isAvailable).toBe(false);
  });

  it('returns isAvailable: true when persons.length === 2', () => {
    usePersonsStore.setState({ persons: [p1, p2], isLoading: false, error: null });

    const { result } = renderHook(() => useViewFilter(), { wrapper: wrapper() });

    expect(result.current.isAvailable).toBe(true);
  });

  it('returns isAvailable: false when persons.length === 0', () => {
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });

    const { result } = renderHook(() => useViewFilter(), { wrapper: wrapper() });

    expect(result.current.isAvailable).toBe(false);
  });

  it('setFilter("p1") updates URL to ?view=p1', () => {
    usePersonsStore.setState({ persons: [p1, p2], isLoading: false, error: null });

    const { result } = renderHook(
      () => {
        const filter = useViewFilter();
        const location = useLocation();
        return { ...filter, search: location.search };
      },
      { wrapper: wrapper() },
    );

    expect(result.current.search).toBe('');

    act(() => {
      result.current.setFilter('p1');
    });

    expect(result.current.search).toBe('?view=p1');
  });

  it('setFilter("household") removes the view param', () => {
    usePersonsStore.setState({ persons: [p1, p2], isLoading: false, error: null });

    const { result } = renderHook(
      () => {
        const filter = useViewFilter();
        const location = useLocation();
        return { ...filter, search: location.search };
      },
      { wrapper: wrapper(['/dashboard?view=p2']) },
    );

    expect(result.current.search).toBe('?view=p2');

    act(() => {
      result.current.setFilter('household');
    });

    expect(result.current.search).not.toContain('view=');
  });

  it('reads URL on mount: ?view=p2 → filter: p2', () => {
    usePersonsStore.setState({ persons: [p1, p2], isLoading: false, error: null });

    const { result } = renderHook(() => useViewFilter(), {
      wrapper: wrapper(['/dashboard?view=p2']),
    });

    expect(result.current.filter).toBe('p2');
  });

  it('invalid ?view=garbage → filter: household (graceful fallback)', () => {
    usePersonsStore.setState({ persons: [p1, p2], isLoading: false, error: null });

    const { result } = renderHook(() => useViewFilter(), {
      wrapper: wrapper(['/dashboard?view=garbage']),
    });

    expect(result.current.filter).toBe('household');
  });

  it('setFilter is a no-op when isAvailable is false (single-person household)', () => {
    usePersonsStore.setState({ persons: [p1], isLoading: false, error: null });

    const { result } = renderHook(
      () => {
        const filter = useViewFilter();
        const location = useLocation();
        return { ...filter, search: location.search };
      },
      { wrapper: wrapper() },
    );

    expect(result.current.isAvailable).toBe(false);
    expect(result.current.search).toBe('');

    act(() => {
      result.current.setFilter('p1');
    });

    expect(result.current.search).toBe('');
    expect(result.current.filter).toBe('household');
  });
});
