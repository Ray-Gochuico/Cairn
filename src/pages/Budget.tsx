import { useEffect, useMemo, useState } from 'react';
import { useCategoriesStore } from '@/stores/categories-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { summarizeBudget, type BudgetRow } from '@/lib/budget-analysis';
import BarChartCard from '@/components/charts/BarChartCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const currency = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

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

  const chartData = summary.rows
    .filter((r) => r.budget != null)
    .map((r) => ({ name: r.categoryName, budget: r.budget as number, actual: r.actual }));

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
    <div className="p-8 max-w-6xl space-y-6">
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

      {chartData.length > 0 ? (
        <BarChartCard
          title="Budget vs actual"
          subtitle={month}
          data={chartData}
          xKey="name"
          series={[
            { dataKey: 'budget', label: 'Budget' },
            { dataKey: 'actual', label: 'Actual' },
          ]}
          yFormatter={currency}
          layout="vertical"
          height={Math.max(240, chartData.length * 40)}
        />
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Set a monthly budget on a category below to see the budget-vs-actual chart.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Category budgets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {groups.map(([parentName, rows]) => {
            const groupBudget = rows.reduce((s, r) => s + (r.budget ?? 0), 0);
            const groupActual = rows.reduce((s, r) => s + r.actual, 0);
            return (
              <div key={parentName}>
                <div className="flex items-center justify-between border-b pb-1 mb-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {parentName}
                  </h2>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {currency(groupActual)} / {currency(groupBudget)}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-4">Category</th>
                      <th className="py-1 pr-4">Monthly budget</th>
                      <th className="py-1 pr-4 text-right">Actual</th>
                      <th className="py-1 pr-4 text-right">Remaining</th>
                      <th className="py-1 text-right">Used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.categoryId} className="border-b last:border-b-0">
                        <td className="py-2 pr-4">{r.categoryName}</td>
                        <td className="py-2 pr-4">
                          <Input
                            type="number"
                            step="1"
                            min="0"
                            className="h-8 w-28"
                            aria-label={`Budget for ${r.categoryName}`}
                            defaultValue={r.budget ?? ''}
                            onBlur={(e) => handleBudgetCommit(r.categoryId, e.target.value, e.target, r.budget)}
                          />
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {currency(r.actual)}
                        </td>
                        <td className={`py-2 pr-4 text-right tabular-nums ${
                          r.overBudget ? 'text-destructive' : ''}`}>
                          {r.remaining != null ? currency(r.remaining) : '—'}
                        </td>
                        <td className={`py-2 text-right tabular-nums ${
                          r.overBudget ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                          {r.pct != null ? `${Math.round(r.pct * 100)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
