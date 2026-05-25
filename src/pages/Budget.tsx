import { useEffect, useMemo, useState } from 'react';
import { useCategoriesStore } from '@/stores/categories-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import {
  summarizeBudget,
  partitionTrackedRows,
  groupByParent,
  MISC_CATEGORY_ID,
  MISC_CATEGORY_NAME,
  type BudgetRow,
} from '@/lib/budget-analysis';
import {
  getTrackedBudgetCategories,
  hasTrackedBudgetCategoriesSelection,
  persistTrackedBudgetCategories,
  trackBudgetCategories,
  untrackBudgetCategory,
} from '@/lib/tracked-budget-categories';
import BudgetOverlayRow from '@/components/budget/BudgetOverlayRow';
import BudgetCategoryPicker from '@/components/budget/BudgetCategoryPicker';
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

  // Tracked-category selection persisted in localStorage. Initial value is
  // whatever's stored (null → []); seeded below from rows that have a budget.
  const [trackedIds, setTrackedIds] = useState<number[]>(
    () => getTrackedBudgetCategories() ?? [],
  );

  // Seed default tracked set once on first load when nothing has been
  // persisted. If any category already carries a budget, seed only those
  // (preserving the prior Mint-style overlay set). On a brand-new install
  // where no budgets exist yet, seed every budgetable category so the user
  // can enter their first budget directly without having to "add" anything.
  useEffect(() => {
    if (hasTrackedBudgetCategoriesSelection()) return;
    if (summary.rows.length === 0) return;
    const budgeted = summary.rows.filter((r) => r.budget != null).map((r) => r.categoryId);
    const seeded = budgeted.length > 0 ? budgeted : summary.rows.map((r) => r.categoryId);
    persistTrackedBudgetCategories(seeded);
    setTrackedIds(seeded);
  }, [summary.rows]);

  const { tracked, misc } = useMemo(
    () => partitionTrackedRows(summary.rows, trackedIds),
    [summary.rows, trackedIds],
  );

  const untrackedRows = useMemo(
    () => summary.rows.filter((r) => !trackedIds.includes(r.categoryId)),
    [summary.rows, trackedIds],
  );

  // Picker shows untracked leaves grouped by their parent category. We resolve
  // each untracked row back to its Category record so groupByParent can read
  // the parent_category_id; rows with no matching category are dropped (the
  // category was deleted out from under the budget — never expected in practice).
  const pickerGroups = useMemo(() => {
    const catById = new Map(
      categories.filter((c) => c.id != null).map((c) => [c.id as number, c]),
    );
    const untrackedCats = untrackedRows
      .map((r) => catById.get(r.categoryId))
      .filter((c): c is NonNullable<typeof c> => c != null);
    return groupByParent(categories, untrackedCats);
  }, [untrackedRows, categories]);

  // Group tracked rows under their parent category for display.
  const groups = useMemo(() => {
    const nameById = new Map(
      categories.filter((c) => c.id != null).map((c) => [c.id as number, c.name]),
    );
    const map = new Map<string, BudgetRow[]>();
    for (const r of tracked) {
      const key = r.parentCategoryId != null
        ? (nameById.get(r.parentCategoryId) ?? 'General')
        : 'General';
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tracked, categories]);

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

  const handleUntrack = (categoryId: number) => {
    untrackBudgetCategory(categoryId);
    setTrackedIds((ids) => ids.filter((id) => id !== categoryId));
  };

  const handleAddCategories = (ids: number[]) => {
    if (ids.length === 0) return;
    trackBudgetCategories(ids);
    setTrackedIds((current) => {
      const merged = [...current];
      for (const id of ids) {
        if (!merged.includes(id)) merged.push(id);
      }
      return merged;
    });
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

      {untrackedRows.length > 0 && (
        <div className="flex items-center text-sm">
          <BudgetCategoryPicker
            groups={pickerGroups}
            onConfirm={handleAddCategories}
          />
        </div>
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
                  <div key={r.categoryId} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <BudgetOverlayRow row={r} onBudgetCommit={handleBudgetCommit} />
                    </div>
                    <button
                      type="button"
                      aria-label={`Untrack ${r.categoryName}`}
                      onClick={() => handleUntrack(r.categoryId)}
                      className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {summary.rows.length > 0 && (
          <div>
            <div className="flex items-center justify-between border-b pb-1 mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {MISC_CATEGORY_NAME}
              </h3>
              <span className="text-xs text-muted-foreground tabular-nums">
                {currency(misc.actual)} of {currency(misc.budget ?? 0)}
              </span>
            </div>
            <div className="divide-y">
              <BudgetOverlayRow row={{ ...misc, categoryId: MISC_CATEGORY_ID }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
