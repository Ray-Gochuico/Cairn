import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryType } from '@/types/enums';
import type { Category, Transaction } from '@/types/schema';

// The hero's donut is Task 12's CategoryDonut; jsdom can't lay out real
// recharts, so mock the primitives (repo idiom).
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-responsive">{children}</div>
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-piechart">{children}</div>
  ),
  Pie: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="rc-pie">{children}</div>
  ),
  Cell: () => null,
  Tooltip: () => null,
}));

import { SpendingSummaryHero } from '@/components/spending/SpendingSummaryHero';

const JUNE_15 = new Date(Date.UTC(2026, 5, 15));

function category(over: Partial<Category> & { id: number; name: string }): Category {
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
    date: over.date ?? '2026-06-10',
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

const cats = [category({ id: 1, name: 'Food', color: '#ff0000' })];
// June-to-date $500; full May $800.
const txns: Transaction[] = [
  txn({ id: 1, date: '2026-06-05', categoryId: 1, amount: 300 }),
  txn({ id: 2, date: '2026-06-10', categoryId: 1, amount: 200 }),
  txn({ id: 3, date: '2026-05-08', categoryId: 1, amount: 500 }),
  txn({ id: 4, date: '2026-05-20', categoryId: 1, amount: 300 }),
];

describe('SpendingSummaryHero', () => {
  it('renders range tabs (same vocabulary as the dashboard widget) with This month active', () => {
    render(<SpendingSummaryHero transactions={txns} categories={cats} monthlyBudget={0} asOf={JUNE_15} />);
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'This month', 'Last month', 'Last 30 days', 'Last 90 days', 'Year to date', 'Last 12 months',
    ]);
    expect(screen.getByRole('tab', { name: 'This month' })).toHaveAttribute('aria-selected', 'true');
  });

  it('headline shows the selected-range total; switching tabs recomputes it', async () => {
    render(<SpendingSummaryHero transactions={txns} categories={cats} monthlyBudget={0} asOf={JUNE_15} />);
    expect(screen.getByTestId('spending-hero-total')).toHaveTextContent('$500'); // June-to-date fixture
    await userEvent.click(screen.getByRole('tab', { name: 'Last month' }));
    expect(screen.getByTestId('spending-hero-total')).toHaveTextContent('$800'); // full-May fixture
  });

  it('this-month range shows the vs-last-month delta and the budget bar; other ranges hide both', async () => {
    render(<SpendingSummaryHero transactions={txns} categories={cats} monthlyBudget={1000} asOf={JUNE_15} />);
    expect(screen.getByText(/vs last month/i)).toBeInTheDocument();
    expect(screen.getByText(/under budget/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Last 90 days' }));
    expect(screen.queryByText(/vs last month/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/under budget/i)).not.toBeInTheDocument();
  });

  it('renders the category donut center total for the selected range', () => {
    render(<SpendingSummaryHero transactions={txns} categories={cats} monthlyBudget={0} asOf={JUNE_15} />);
    expect(screen.getByTestId('spending-hero-center')).toHaveTextContent('Total spending');
  });
});
