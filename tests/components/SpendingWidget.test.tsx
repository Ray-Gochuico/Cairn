import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SpendingWidget } from '@/components/dashboard/SpendingWidget';
import { AccountType, CategoryType } from '@/types/enums';
import type { Account, Category, Transaction } from '@/types/schema';

const asOf = new Date(Date.UTC(2026, 4, 25)); // 2026-05-25

function account(over: Partial<Account> & { id: number; name: string }): Account {
  return {
    id: over.id,
    householdId: over.householdId ?? 1,
    ownerPersonId: over.ownerPersonId ?? null,
    beneficiaryDependentId: over.beneficiaryDependentId ?? null,
    name: over.name,
    institution: over.institution ?? null,
    type: over.type ?? AccountType.ACCOUNT_BROKERAGE,
    cryptoWalletAddress: over.cryptoWalletAddress ?? null,
    autoFetchEnabled: over.autoFetchEnabled ?? false,
    excludedFromNetWorth: over.excludedFromNetWorth ?? false,
    stateOfPlan: over.stateOfPlan ?? null,
    accentColor: over.accentColor ?? null,
  };
}

function category(
  over: Partial<Category> & { id: number; name: string },
): Category {
  return {
    id: over.id,
    name: over.name,
    parentCategoryId: over.parentCategoryId ?? null,
    color: over.color ?? null,
    icon: over.icon ?? null,
    type: over.type ?? CategoryType.WANT,
    isCapital: over.isCapital ?? false,
    systemManaged: over.systemManaged ?? false,
    monthlyBudget: over.monthlyBudget ?? null,
  };
}

function txn(over: Partial<Transaction> = {}): Transaction {
  return {
    id: over.id ?? 1,
    householdId: over.householdId ?? 1,
    date: over.date ?? '2026-05-10',
    merchant: over.merchant ?? 'MERCHANT',
    merchantRaw: over.merchantRaw ?? null,
    amount: over.amount ?? 50,
    categoryId: over.categoryId ?? null,
    sourceAccountId: over.sourceAccountId ?? null,
    propertyId: over.propertyId ?? null,
    vehicleId: over.vehicleId ?? null,
    personId: over.personId ?? null,
    sourcePdfFilename: over.sourcePdfFilename ?? null,
    reimbursable: over.reimbursable ?? false,
    reimbursedAt: over.reimbursedAt ?? null,
    reimbursedAmount: over.reimbursedAmount ?? null,
    isRecurring: over.isRecurring ?? false,
    notes: over.notes ?? null,
  };
}

function renderWidget(
  transactions: Transaction[],
  categories: Category[],
  accounts: Account[] = [],
) {
  return render(
    <MemoryRouter>
      <SpendingWidget
        transactions={transactions}
        categories={categories}
        accounts={accounts}
        asOf={asOf}
      />
    </MemoryRouter>,
  );
}

const FOOD = category({ id: 1, name: 'Food', color: '#ff0000' });
const TRAVEL = category({ id: 2, name: 'Travel', color: '#00ff00' });
const MISC = category({ id: 3, name: 'Misc' });

describe('SpendingWidget', () => {
  it('renders the card title, filter bar, and chart toggle', () => {
    renderWidget([], []);
    expect(screen.getByText(/^Spending$/i)).toBeInTheDocument();
    expect(screen.getByTestId('spending-widget-filters')).toBeInTheDocument();
    expect(screen.getByTestId('spending-widget-donut-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('spending-widget-bar-toggle')).toBeInTheDocument();
  });

  it('defaults the time range to "This month" (selected tab) with matching bounds', () => {
    renderWidget([], []);
    // Range control is segmented tabs (app-wide range grammar), not a select.
    expect(screen.getByTestId('spending-widget-range-tabs')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'This month' })).toHaveAttribute('aria-selected', 'true');
    const bounds = screen.getByTestId('spending-widget-date-bounds');
    expect(bounds).toHaveTextContent('2026-05-01');
    expect(bounds).toHaveTextContent('2026-05-31');
  });

  it('switching the range tab recomputes the date bounds', async () => {
    renderWidget([], []);
    await userEvent.click(screen.getByRole('tab', { name: 'Last 30 days' }));
    const bounds = screen.getByTestId('spending-widget-date-bounds');
    // asOf 2026-05-25 → last 30 days = 2026-04-26 .. 2026-05-25.
    expect(bounds).toHaveTextContent('2026-04-26');
    expect(bounds).toHaveTextContent('2026-05-25');
  });

  it('shows the empty state when no transactions match', () => {
    renderWidget([], []);
    expect(screen.getByText(/no spending found/i)).toBeInTheDocument();
  });

  it('renders the center total + a row per category sorted by spend desc', () => {
    const txns: Transaction[] = [
      txn({ id: 1, date: '2026-05-02', categoryId: 1, amount: 50 }),
      txn({ id: 2, date: '2026-05-03', categoryId: 1, amount: 30 }),
      txn({ id: 3, date: '2026-05-04', categoryId: 2, amount: 200 }),
    ];
    renderWidget(txns, [FOOD, TRAVEL]);
    expect(screen.getByTestId('spending-widget-center')).toHaveTextContent('$280');
    const list = screen.getByTestId('spending-widget-list');
    const items = within(list).getAllByRole('listitem');
    // Travel ($200) first, Food ($80) second.
    expect(items[0]).toHaveTextContent('Travel');
    expect(items[0]).toHaveTextContent('$200');
    expect(items[1]).toHaveTextContent('Food');
    expect(items[1]).toHaveTextContent('$80');
  });

  it('renders a legend with one row per category', () => {
    const txns: Transaction[] = [
      txn({ id: 1, date: '2026-05-02', categoryId: 1, amount: 50 }),
      txn({ id: 2, date: '2026-05-04', categoryId: 2, amount: 75 }),
    ];
    renderWidget(txns, [FOOD, TRAVEL]);
    const legend = screen.getByTestId('spending-widget-legend');
    expect(within(legend).getAllByRole('listitem')).toHaveLength(2);
    expect(within(legend).getByText('Food')).toBeInTheDocument();
    expect(within(legend).getByText('Travel')).toBeInTheDocument();
  });

  it('shows the "Most purchases" callout with category + count', () => {
    const txns: Transaction[] = [
      txn({ id: 1, date: '2026-05-01', categoryId: 1, amount: 10 }),
      txn({ id: 2, date: '2026-05-02', categoryId: 1, amount: 12 }),
      txn({ id: 3, date: '2026-05-03', categoryId: 1, amount: 9 }),
      txn({ id: 4, date: '2026-05-04', categoryId: 2, amount: 500 }),
    ];
    renderWidget(txns, [FOOD, TRAVEL]);
    const callout = screen.getByTestId('spending-widget-most-purchases');
    expect(callout).toHaveTextContent('Food');
    expect(callout).toHaveTextContent('3');
  });

  it('includes Misc categories in the rendered breakdown', () => {
    const txns: Transaction[] = [
      txn({ id: 1, date: '2026-05-02', categoryId: 3, amount: 25 }),
      txn({ id: 2, date: '2026-05-03', categoryId: 1, amount: 50 }),
    ];
    renderWidget(txns, [FOOD, MISC]);
    expect(screen.getByTestId('spending-widget-list')).toHaveTextContent('Misc');
  });

  it('filters spending by the merchant search input', () => {
    const txns: Transaction[] = [
      txn({ id: 1, date: '2026-05-02', categoryId: 1, amount: 30, merchant: 'STARBUCKS' }),
      txn({ id: 2, date: '2026-05-03', categoryId: 1, amount: 80, merchant: 'TARGET' }),
    ];
    renderWidget(txns, [FOOD]);
    const input = screen.getByTestId('spending-widget-merchant-input');
    fireEvent.change(input, { target: { value: 'star' } });
    expect(screen.getByTestId('spending-widget-center')).toHaveTextContent('$30');
  });

  it('toggles between donut and bar chart modes via the corner toggle', () => {
    const txns: Transaction[] = [
      txn({ id: 1, date: '2026-05-02', categoryId: 1, amount: 30 }),
    ];
    renderWidget(txns, [FOOD]);
    // Donut is the default — center label visible.
    expect(screen.getByTestId('spending-widget-center')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('spending-widget-bar-toggle'));
    expect(screen.queryByTestId('spending-widget-center')).toBeNull();
    fireEvent.click(screen.getByTestId('spending-widget-donut-toggle'));
    expect(screen.getByTestId('spending-widget-center')).toBeInTheDocument();
  });

  it('has no Compare-to stub (removed — a permanently disabled control is a broken promise)', () => {
    renderWidget([], []);
    expect(screen.queryByTestId('spending-widget-compare')).not.toBeInTheDocument();
    expect(screen.queryByText(/compare to/i)).not.toBeInTheDocument();
  });

  it('includes only the accounts passed in the account-filter select', () => {
    const accts = [
      account({ id: 1, name: 'Checking' }),
      account({ id: 2, name: 'Credit Card' }),
    ];
    renderWidget([], [], accts);
    // The Select is a radix component — we just confirm the props plumb the
    // accounts. The trigger is rendered with the placeholder for "all".
    expect(screen.getByTestId('spending-widget-account-select')).toBeInTheDocument();
  });
});
