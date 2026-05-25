import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useRealState } from '@/components/whatif/useRealState';
import { useHouseholdStore } from '@/stores/household-store';
import { useLoansStore } from '@/stores/loans-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useScenariosStore } from '@/stores/scenarios-store';
import { FilingStatus } from '@/types/enums';

function resetStores() {
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE, state: 'CA', city: null,
      monthlyExpenseBaseline: 4500,
      withdrawalRate: 0.04, inflationAssumption: 0.025,
      growthScenarios: [],
    } as any,
    isLoading: false, error: null,
  });
  useLoansStore.setState({
    loans: [{ id: 1, householdId: 1, name: 'Auto', type: 'AUTO', currentBalance: 18400, interestRate: 0.059, monthlyPayment: 425, termMonths: 60 } as any],
    isLoading: false, error: null, load: async () => {},
  } as any);
  useHoldingsStore.setState({
    holdings: [{ id: 1, accountId: 1, ticker: 'VTI', shareCount: 1000, costBasis: 200, targetAllocationPct: null } as any],
    isLoading: false, error: null, load: async () => {},
  } as any);
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} } as any);
  useTransactionsStore.setState({ transactions: [], isLoading: false, error: null, load: async () => {} } as any);
  useScenariosStore.setState({
    scenarios: [], isLoading: false, error: null,
    horizonMonths: 360, dollarMode: 'nominal',
    inflation: 0.025, defaultReturnRate: 0.07,
    projectionCache: new Map(),
  });
}

const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

describe('useRealState', () => {
  beforeEach(() => { resetStores(); });

  it('returns null until household has loaded', () => {
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
    const { result } = renderHook(() => useRealState(), { wrapper });
    expect(result.current).toBeNull();
  });

  it('assembles a RealState from the populated stores', () => {
    const { result } = renderHook(() => useRealState(), { wrapper });
    const real = result.current!;
    expect(real).not.toBeNull();
    expect(real.loans).toHaveLength(1);
    expect(real.loans[0].currentBalance).toBe(18400);
    expect(real.holdings[0].shareCount).toBe(1000);
    expect(real.defaults.inflation).toBeCloseTo(0.025, 4);
    expect(real.defaults.returnRate).toBeCloseTo(0.07, 4);
    expect(real.startISO).toMatch(/^\d{4}-\d{2}$/);
  });

  it('preferring household.monthlyExpenseBaseline over transactions-derived expenses when set', () => {
    const { result } = renderHook(() => useRealState(), { wrapper });
    expect(result.current!.baselineMonthlyExpenses).toBe(4500);
  });
});
