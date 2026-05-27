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
import { useSettingsStore } from '@/stores/settings-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';
import type { TaxRule } from '@/types/schema';

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
  });
  useTaxRulesStore.setState({ year: null, items: [], isLoading: false, error: null });
  // Default settings: nothing set (settings.defaultInflation === null
  // means "fall back to the scenarios-store default").
  useSettingsStore.setState({
    settings: null,
    isLoading: false,
    error: null,
    load: async () => {},
    update: async () => {},
  } as any);
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

  it('no longer exposes baselineMonthlyExpenses on the returned state (2026-05-26 revamp)', () => {
    const { result } = renderHook(() => useRealState(), { wrapper });
    // Expenses are now sourced entirely from the lever's `expensePeriods`
    // payload. The hook no longer rewrites `real.baselineMonthlyExpenses`.
    expect((result.current as Record<string, unknown>).baselineMonthlyExpenses).toBeUndefined();
  });

  it('NEW-W7-WI1: settings.defaultInflation overrides scenarios-store default when set', () => {
    // Pre-fix the engine only saw the scenarios-store value (0.025 default).
    // Settings → Advanced → Default inflation now wins when set.
    useSettingsStore.setState({
      settings: {
        id: 1,
        sidebarLayout: null,
        notificationsEnabled: true,
        notificationDay: 1,
        refreshCadence: 'EVERY_LAUNCH',
        lastRefreshAt: null,
        statementsFolderPath: null,
        defaultInflation: 0.04,
        defaultReturnRate: null,
        defaultCashApy: null,
        defaultDrawdownTaxRate: null,
      } as any,
      isLoading: false,
      error: null,
      load: async () => {},
      update: async () => {},
    } as any);
    useScenariosStore.setState({
      scenarios: [], isLoading: false, error: null,
      horizonMonths: 360, dollarMode: 'nominal',
      inflation: 0.025, defaultReturnRate: 0.07,
    });
    const { result } = renderHook(() => useRealState(), { wrapper });
    expect(result.current!.defaults.inflation).toBeCloseTo(0.04, 4);
  });

  it('NEW-W7-WI1: falls back to scenarios-store inflation when settings.defaultInflation is null', () => {
    // null = unset; scenarios-store default (0.025) wins.
    useSettingsStore.setState({
      settings: {
        id: 1,
        sidebarLayout: null,
        notificationsEnabled: true,
        notificationDay: 1,
        refreshCadence: 'EVERY_LAUNCH',
        lastRefreshAt: null,
        statementsFolderPath: null,
        defaultInflation: null,
        defaultReturnRate: null,
        defaultCashApy: null,
        defaultDrawdownTaxRate: null,
      } as any,
      isLoading: false,
      error: null,
      load: async () => {},
      update: async () => {},
    } as any);
    useScenariosStore.setState({
      scenarios: [], isLoading: false, error: null,
      horizonMonths: 360, dollarMode: 'nominal',
      inflation: 0.025, defaultReturnRate: 0.07,
    });
    const { result } = renderHook(() => useRealState(), { wrapper });
    expect(result.current!.defaults.inflation).toBeCloseTo(0.025, 4);
  });

  it('threads tax-rules-store items onto RealState.taxBrackets for the household jurisdiction', () => {
    const federalRule: TaxRule = {
      year: 2026,
      jurisdictionType: 'FEDERAL',
      jurisdictionCode: 'US',
      filingStatus: FilingStatus.SINGLE,
      brackets: [
        { min: 0, max: 11600, rate: 0.10 },
        { min: 11600, max: 47150, rate: 0.12 },
      ],
      standardDeduction: 14600,
    };
    const caRule: TaxRule = {
      year: 2026,
      jurisdictionType: 'STATE',
      jurisdictionCode: 'CA',
      filingStatus: FilingStatus.SINGLE,
      brackets: [{ min: 0, max: 10412, rate: 0.01 }],
      standardDeduction: 5363,
    };
    useTaxRulesStore.setState({ year: 2026, items: [federalRule, caRule], isLoading: false, error: null });

    const { result } = renderHook(() => useRealState(), { wrapper });
    const real = result.current!;
    expect(real.taxBrackets.federal.length).toBeGreaterThan(0);
    expect(real.taxBrackets.state.length).toBeGreaterThan(0);
    // Post-Task-2: per-jurisdiction SD object. CA state SD = $5,540 for SINGLE.
    expect(real.taxBrackets.standardDeduction).toMatchObject({ federal: 14600 });
  });
});
