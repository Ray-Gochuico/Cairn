import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ExpensePeriodsPopover from '@/components/whatif/levers/ExpensePeriodsPopover';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useHouseholdStore } from '@/stores/household-store';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';

// R1 review (MINOR 6). A RealState WITHOUT `expenseBasis` is a SUPPORTED shape —
// the Feature-B back-compat contract. `captureRealState` always populates it in
// production, so the only way to reach the shape is a hand-built fixture (the
// WhatIf.management mock is one), and before this fix the two data-mode reads
// dereferenced `expenseBasis` directly: selecting either data mode over such a
// RealState threw, while the always-evaluated count read did not. Every read is
// optional-chained now; these three cases hold that.
//
// `vi.mock` is file-scoped and hoisted, which is why this pin lives in its own
// file rather than inside the main popover suite (whose other ~20 tests need the
// real hook). No clock is read here — the file is outside the P3 ratchet.
vi.mock('@/components/whatif/useRealState', () => ({
  useRealState: () => ({
    startISO: '2026-05',
    accounts: [], holdings: [], loans: [], loanPayments: [], persons: [],
    household: { id: 1, filingStatus: 'SINGLE', state: 'TX', city: null, monthlyExpenseBaseline: 4500 },
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 0,
    initialInvestmentsByAccount: {},
    defaults: { inflation: 0.025, returnRate: 0.07 },
    taxBrackets: { federal: [], state: [], city: null, ltcg: [], standardDeduction: { federal: 0, state: 0, city: 0 } },
    housingPayments: [], vehicleLeases: [],
    // expenseBasis: DELIBERATELY ABSENT — that is the whole point of this file.
  }),
}));

function seed(expenseSource: 'latestMonth' | 'rolling12m' | 'custom') {
  useHouseholdStore.setState({
    household: {
      filingStatus: 'SINGLE', state: 'TX', city: null,
      monthlyExpenseBaseline: 4500, withdrawalRate: 0.04, inflationAssumption: 0.03,
      growthScenarios: [],
    } as never,
    isLoading: false,
    error: null,
  });
  useScenariosStore.setState({
    scenarios: [{
      id: 1, name: 'S', isBaseline: false, color: '#4f86f7', lineStyle: 'solid',
      visible: true, isActive: true, sortOrder: 0,
      leverPayload: { ...emptyLeverPayload(), expenseSource, customMonthly: 0, expensePeriods: [] },
      createdAt: '', updatedAt: '',
    } as Scenario],
    isLoading: false,
    error: null,
    horizonMonths: 360,
    dollarMode: 'nominal',
    inflation: 0.025,
    defaultReturnRate: 0.07,
    updateLever: vi.fn().mockResolvedValue(undefined) as never,
  });
}

const renderPopover = () =>
  render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);

describe('ExpensePeriodsPopover — a RealState without expenseBasis (Feature-B back-compat)', () => {
  it('Spending average mode reads 0 instead of throwing', () => {
    seed('rolling12m');
    expect(renderPopover).not.toThrow();
    expect(screen.getByText('No complete month of spending yet')).toBeInTheDocument();
  });

  it('Latest complete month mode reads 0 instead of throwing', () => {
    seed('latestMonth');
    expect(renderPopover).not.toThrow();
    expect(screen.getByText('No complete month of spending yet')).toBeInTheDocument();
  });

  it('custom mode still renders its base (the always-evaluated count read)', () => {
    seed('custom');
    expect(renderPopover).not.toThrow();
    expect(screen.getByTestId('expense-base')).toHaveTextContent('$0');
    expect(screen.getByTestId('expense-base-source')).toHaveTextContent('(custom monthly expense)');
  });
});
