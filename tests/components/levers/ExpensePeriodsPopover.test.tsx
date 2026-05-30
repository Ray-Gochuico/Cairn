import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ExpensePeriodsPopover from '@/components/whatif/levers/ExpensePeriodsPopover';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useLoansStore } from '@/stores/loans-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';
import type { ExpensePeriod } from '@/lib/scenarios';

function resetStores(opts: { expensePeriods?: ExpensePeriod[] } = {}) {
  const payload = emptyLeverPayload();
  if (opts.expensePeriods) payload.expensePeriods = opts.expensePeriods;
  useScenariosStore.setState({
    scenarios: [{
      id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid',
      visible: true, isActive: true, sortOrder: 0, leverPayload: payload,
      createdAt: 't', updatedAt: 't',
    } as Scenario],
    isLoading: false, error: null,
    horizonMonths: 360, dollarMode: 'nominal',
    inflation: 0.025, defaultReturnRate: 0.07,
    updateLever: vi.fn().mockResolvedValue(undefined) as any,
  });
}

const today = new Date();
const todayMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const todayDate = `${todayMonth}-01`;

describe('ExpensePeriodsPopover', () => {
  beforeEach(() => { resetStores(); });

  it('clicking + Add appends a row and shows the live total-cost preview', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add period/i }));
    fireEvent.change(screen.getByLabelText(/start \(YYYY-MM-DD\)/i), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('Monthly expense'), { target: { value: '1500' } });
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '6' } });
    expect(await screen.findByText(/\$9,000\s*total/i)).toBeInTheDocument();
  });

  it('Apply calls updateLever with the expensePeriods slice', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add period/i }));
    fireEvent.change(screen.getByLabelText(/start \(YYYY-MM-DD\)/i), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('Monthly expense'), { target: { value: '1500' } });
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '6' } });
    await user.click(screen.getByRole('button', { name: /apply/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(1, expect.objectContaining({
      expensePeriods: [expect.objectContaining({ start: '2026-07-01', monthlyDelta: 1500, durationMonths: 6 })],
    }));
  });
});

describe('ExpensePeriodsPopover — monthly + annual summary (revamp 2026-05-26)', () => {
  it('shows the current monthly expense at the top', async () => {
    resetStores({
      expensePeriods: [{ start: todayDate, monthlyDelta: 5000, durationMonths: 12 }],
    });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId('expense-summary-monthly')).toHaveTextContent(/\$5,000/);
    expect(screen.getByTestId('expense-summary-annual')).toHaveTextContent(/\$60,000/);
  });

  it('updates the summary live as the user edits a period', async () => {
    resetStores({
      expensePeriods: [{ start: todayDate, monthlyDelta: 5000, durationMonths: 12 }],
    });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const input = screen.getByLabelText('Monthly expense');
    fireEvent.change(input, { target: { value: '6000' } });
    expect(screen.getByTestId('expense-summary-monthly')).toHaveTextContent(/\$6,000/);
    expect(screen.getByTestId('expense-summary-annual')).toHaveTextContent(/\$72,000/);
  });

  it('shows $0/mo when there are no active periods', () => {
    resetStores({ expensePeriods: [] });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId('expense-summary-monthly')).toHaveTextContent('$0');
  });
});

describe('ExpensePeriodsPopover — label changes (revamp 2026-05-26)', () => {
  it('shows "Monthly expense" label on the amount input (not "Δ monthly")', () => {
    resetStores({
      expensePeriods: [{ start: todayDate, monthlyDelta: 5000, durationMonths: 12 }],
    });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByLabelText(/^Monthly expense$/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Δ monthly$/)).toBeNull();
  });
});

describe('ExpensePeriodsPopover — baseline section removed (revamp 2026-05-26)', () => {
  it('does NOT render the monthly-expense-baseline input', () => {
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.queryByLabelText(/Custom monthly baseline/i)).toBeNull();
    expect(screen.queryByTestId('expense-baseline-suggestions')).toBeNull();
  });

  it('does NOT render recent-month or 12mo-avg chips', () => {
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.queryByText(/12mo avg/i)).toBeNull();
    expect(screen.queryByText(/no transactions yet/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 8 — expense-source selector, base+adjustments=effective, empty-data gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seed all stores that useRealState reads from.
 * We pass transactions + categories so expenseBasis is computed correctly.
 */
function seedAllStores(opts: {
  transactions?: Parameters<typeof useTransactionsStore['setState']>[0] extends { transactions: infer T } ? T : never;
  expenseSource?: string;
  customMonthly?: number;
  expensePeriods?: ExpensePeriod[];
  householdBaseline?: number;
} = {}) {
  const {
    transactions = [],
    expenseSource = 'custom',
    customMonthly = 0,
    expensePeriods = [],
    householdBaseline = 4500,
  } = opts;

  const payload = {
    ...emptyLeverPayload(),
    expenseSource,
    customMonthly,
    expensePeriods,
  };

  useHouseholdStore.setState({
    household: {
      filingStatus: 'SINGLE',
      state: 'TX',
      city: null,
      monthlyExpenseBaseline: householdBaseline,
      withdrawalRate: 0.04,
      inflationAssumption: 0.03,
      growthScenarios: [],
    } as any,
    isLoading: false,
    error: null,
  });

  useCategoriesStore.setState({
    categories: [
      {
        id: 1, name: 'Groceries', parentCategoryId: null, color: null,
        icon: null, type: 'EXPENSE', isCapital: false, systemManaged: false, monthlyBudget: null,
      },
    ] as any,
    isLoading: false,
    error: null,
  });

  useTransactionsStore.setState({
    transactions: transactions as any,
    isLoading: false,
    error: null,
    load: async () => {},
  } as any);

  usePersonsStore.setState({
    persons: [],
    isLoading: false,
    error: null,
  } as any);
  useLoansStore.setState({ loans: [], isLoading: false, error: null, load: async () => {} } as any);
  useHoldingsStore.setState({ holdings: [], isLoading: false, error: null, load: async () => {} } as any);
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} } as any);
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: async () => {} } as any);
  useSettingsStore.setState({
    settings: null,
    isLoading: false,
    error: null,
    load: async () => {},
    update: async () => {},
  } as any);
  useTaxRulesStore.setState({ year: null, items: [], isLoading: false, error: null } as any);
  useHousingPaymentsStore.setState({ housingPayments: [], isLoading: false, error: null, load: async () => {} } as any);
  useVehicleLeasesStore.setState({ vehicleLeases: [], isLoading: false, error: null, load: async () => {} } as any);

  useScenariosStore.setState({
    scenarios: [{
      id: 1, name: 'S', isBaseline: false, color: '#4f86f7', lineStyle: 'solid',
      visible: true, isActive: true, sortOrder: 0, leverPayload: payload,
      createdAt: '', updatedAt: '',
    } as Scenario],
    isLoading: false,
    error: null,
    horizonMonths: 360,
    dollarMode: 'nominal',
    inflation: 0.025,
    defaultReturnRate: 0.07,
    updateLever: vi.fn().mockResolvedValue(undefined) as any,
  });
}

describe('ExpensePeriodsPopover — expense-source selector (Task 8)', () => {
  beforeEach(() => {
    seedAllStores({ transactions: [] });
  });

  it('renders the three-way selector as a tablist', () => {
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: /latest complete month/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /12-month average/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /custom monthly expense/i })).toBeInTheDocument();
  });

  it('shows the resolved base WITH its source labeled, and the base+adjustments=effective sum', () => {
    // April transaction = $3000, latestMonth mode → base = 3000, period delta = 500
    seedAllStores({
      transactions: [{
        id: 1, householdId: 1, date: '2026-04-10', amount: 3000,
        merchant: 'M', merchantRaw: null, categoryId: 1, sourceAccountId: 1,
      }] as any,
      expenseSource: 'latestMonth',
      expensePeriods: [{ start: '2026-05-01', monthlyDelta: 500, durationMonths: 480 }],
    });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId('expense-base')).toHaveTextContent('3,000');
    expect(screen.getByTestId('expense-base-source')).toHaveTextContent(/latest complete month/i);
    expect(screen.getByTestId('expense-effective')).toHaveTextContent('3,500');
  });

  it('custom mode reveals a validated monthly input bound to customMonthly', () => {
    seedAllStores({ transactions: [], expenseSource: 'custom', customMonthly: 0 });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Custom monthly expense'), { target: { value: '4200' } });
    expect(screen.getByTestId('expense-base')).toHaveTextContent('4,200');
  });

  it('HARD-GATED empty-data state: a data mode with no spending surfaces the no-data notice + a one-tap baseline prefill', () => {
    seedAllStores({ transactions: [], expenseSource: 'rolling12m', householdBaseline: 4500 });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByText(/no spending data in this window/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /use my \$4,500 expense baseline/i }));
    expect(screen.getByTestId('expense-base')).toHaveTextContent('4,500');
  });

  it('empty-data with NO household baseline: no dangling "or:", offers a Custom fallback action (UX F-5)', () => {
    seedAllStores({ transactions: [], expenseSource: 'rolling12m', householdBaseline: 0 });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByText(/no spending data in this window/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /expense baseline/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/, or:/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /switch to custom/i }));
    expect(screen.getByRole('tab', { name: /custom monthly expense/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('Apply writes expenseSource + customMonthly to the lever', async () => {
    seedAllStores({
      transactions: [{
        id: 1, householdId: 1, date: '2026-04-10', amount: 3000,
        merchant: 'M', merchantRaw: null, categoryId: 1, sourceAccountId: 1,
      }] as any,
      expenseSource: 'custom',
      customMonthly: 0,
    });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Custom monthly expense'), { target: { value: '4200' } });
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    const spy = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    const patch = spy.mock.calls.at(-1)![1];
    expect(patch).toMatchObject({ expenseSource: 'custom', customMonthly: 4200 });
  });
});
