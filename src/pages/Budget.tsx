import { useEffect, useMemo, useState } from 'react';
import { useCategoriesStore } from '@/stores/categories-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { summarizeBudget, type BudgetRow } from '@/lib/budget-analysis';
import BudgetOverlayRow from '@/components/budget/BudgetOverlayRow';
import { Card, CardContent } from '@/components/ui/card';

const currency = (n: number) =>
  `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function Budget() {
  const categories = useCategoriesStore((s) => s.categories);
  const loadCategories = useCategoriesStore((s) => s.load);
  const updateCategory = useCategoriesStore((s) => s.update);
  const transactions = useTransactionsStore((s) => s.transactions);
  const loadTransactions = useTransactionsStore((s) => s.load);

  useEffect(() => {
    loadCategories();
    loadTransactions();
  }, [loadCategories, loadTransactions]);

  const months = useMemo(() => {
    const set = new Set(transactions.map((t) => t.date.slice(0, 7)));
    set.add(new Date().toISOString().slice(0, 7));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [transactions]);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const summary = useMemo(
    () => summarizeBudget(categories, transactions, month),
    [categories, transactions, month],
  );

  // Group budget rows under their parent category for display.
  const groups = useMemo(() => {
    const nameById = new Map(
      categories.filter((c) => c.id != null).map((c) => [c.id as number, c.name]),
    );
    const map = new Map<string, BudgetRow[]>();
    for (const r of summary.rows) {
      const key = r.parentCategoryId != null
        ? (nameById.get(r.parentCategoryId) ?? 'General')
        : 'General';
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [summary.rows, categories]);

  const anyBudgetSet = summary.rows.some((r) => r.budget != null);

  const handleBudgetCommit = async (
    categoryId: number,
    raw: string,
    inputEl: HTMLInputElement,
    savedBudget: number | null,
  ) => {
    const trimmed = raw.trim();
    const value = trimmed === '' ? null : Number(trimmed);
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      // Rejected — revert the displayed value to the last-saved budget.
      inputEl.value = savedBudget != null ? String(savedBudget) : '';
      return;
    }
    await updateCategory(categoryId, { monthlyBudget: value });
  };

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Budget</h1>
          <p className="text-sm text-muted-foreground">
            Set a monthly target per category and track it against actual spending.
          </p>
        </div>
        <select
          aria-label="Month"
          className="flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {anyBudgetSet ? (
        <div className="flex items-baseline justify-between border-b pb-2">
          <h2 className="text-lg font-semibold">Spending</h2>
          <span className="text-sm text-muted-foreground tabular-nums">
            {currency(summary.totalActual)} of {currency(summary.totalBudget)}
          </span>
        </div>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Set a monthly budget on a category below to see the budget-vs-actual overlay.
          </CardContent>
        </Card>
      )}

      <div className="space-y-8">
        {groups.map(([parentName, rows]) => {
          const groupBudget = rows.reduce((s, r) => s + (r.budget ?? 0), 0);
          const groupActual = rows.reduce((s, r) => s + r.actual, 0);
          return (
            <div key={parentName}>
              <div className="flex items-center justify-between border-b pb-1 mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {parentName}
                </h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {currency(groupActual)} of {currency(groupBudget)}
                </span>
              </div>
              <div className="divide-y">
                {rows.map((r) => (
                  <BudgetOverlayRow
                    key={r.categoryId}
                    row={r}
                    onBudgetCommit={handleBudgetCommit}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
