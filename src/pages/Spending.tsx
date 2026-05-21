import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { extractTextItems } from '@/pdf/extract';
import { parseStatement } from '@/pdf/parse-statement';
import { PdfReviewModal } from '@/components/dialogs/PdfReviewModal';
import { MarkReimbursedDialog } from '@/components/dialogs/MarkReimbursedDialog';
import BarChartCard from '@/components/charts/BarChartCard';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { summarizeSpending } from '@/lib/spending-analysis';
import { detectRecurring } from '@/lib/recurring';
import { cashflowWindow } from '@/lib/cashflow';
import type { ParseResult } from '@/pdf/parse-statement';
import type { Transaction } from '@/types/schema';

interface PendingImport {
  result: ParseResult;
  filename: string;
}

export default function Spending() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<PendingImport[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [reimbursedTarget, setReimbursedTarget] = useState<Transaction | null>(null);

  const transactions = useTransactionsStore((s) => s.transactions);
  const loadTransactions = useTransactionsStore((s) => s.load);
  const syncRecurring = useTransactionsStore((s) => s.syncRecurring);
  const categories = useCategoriesStore((s) => s.categories);
  const loadCategories = useCategoriesStore((s) => s.load);
  const household = useHouseholdStore((s) => s.household);
  const loadHousehold = useHouseholdStore((s) => s.load);
  const persons = usePersonsStore((s) => s.persons);
  const loadPersons = usePersonsStore((s) => s.load);

  useEffect(() => {
    void Promise.all([
      loadTransactions(),
      loadCategories(),
      loadHousehold(),
      loadPersons(),
    ]).then(() => syncRecurring(useCategoriesStore.getState().categories));
  }, [loadTransactions, loadCategories, loadHousehold, loadPersons, syncRecurring]);

  // --- Analysis ---
  const summary = useMemo(
    () => summarizeSpending(transactions, categories),
    [transactions, categories],
  );
  const recurring = useMemo(() => detectRecurring(transactions, categories), [transactions, categories]);

  // Category lookup for display
  const categoryById = useMemo(
    () => new Map(categories.filter((c) => c.id != null).map((c) => [c.id as number, c])),
    [categories],
  );

  // Monthly category bars data — pivot monthlyByCategory into chart rows
  const monthlyBarData = useMemo(() => {
    const byMonth = new Map<string, Record<string, number>>();
    for (const row of summary.monthlyByCategory) {
      const catName = row.categoryId != null
        ? (categoryById.get(row.categoryId)?.name ?? `Cat ${row.categoryId}`)
        : 'Uncategorized';
      const existing = byMonth.get(row.month) ?? {};
      existing[catName] = (existing[catName] ?? 0) + row.total;
      byMonth.set(row.month, existing);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, cats]) => ({ month, ...cats }));
  }, [summary.monthlyByCategory, categoryById]);

  // Derive the unique category keys that appear in chart data
  const categorySeries = useMemo(() => {
    const keys = new Set<string>();
    for (const row of monthlyBarData) {
      for (const k of Object.keys(row)) {
        if (k !== 'month') keys.add(k);
      }
    }
    return [...keys].map((name) => ({
      dataKey: name,
      label: name,
    }));
  }, [monthlyBarData]);

  // Awaiting reimbursement
  const awaitingReimbursement = useMemo(
    () => transactions.filter((t) => t.reimbursable && t.reimbursedAt == null),
    [transactions],
  );

  // Rolling 30-day cashflow
  // Inflow = sum of each person's estimated monthly net income.
  // A simple approximation: annualSalaryPretax / 12 (gross); the plan notes
  // exact proration/tax is the implementer's call (design spec § Open questions).
  const estimatedMonthlyInflow = useMemo(
    () => persons.reduce((s, p) => s + p.annualSalaryPretax / 12, 0),
    [persons],
  );
  const cashflow = useMemo(
    () => cashflowWindow(transactions, estimatedMonthlyInflow, 30, categories),
    [transactions, estimatedMonthlyInflow, categories],
  );

  // Budget data
  const budget = household?.monthlyExpenseBaseline ?? 0;
  const currentTotal = summary.currentMonthTotal;
  const budgetPct = budget > 0 ? Math.min(currentTotal / budget, 1) : 0;
  const overBudget = budget > 0 && currentTotal > budget;

  // MoM comparison (month-to-date vs last month's full total)
  const momDelta = currentTotal - summary.previousMonthTotal;

  // Recurring total
  const recurringTotal = recurring.reduce((s, g) => s + g.averageAmount, 0);

  // --- Import handlers ---
  const processFiles = useCallback(async (files: File[]) => {
    setImportError(null);
    const results: PendingImport[] = [];
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const items = await extractTextItems(bytes);
        const result = parseStatement(items);
        results.push({ result, filename: file.name });
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err));
      }
    }
    if (results.length > 0) {
      setQueue((prev) => [...prev, ...results]);
    }
  }, []);

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) await processFiles(files);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === 'application/pdf',
    );
    if (files.length > 0) await processFiles(files);
  };

  const handleModalClose = () => setQueue((prev) => prev.slice(1));
  const handleModalSaved = async (_insertedCount: number) => {
    await loadTransactions();
    setQueue((prev) => prev.slice(1));
  };

  const current = queue[0];

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-2xl font-semibold">Spending</h1>

      {/* Import area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-6 text-center space-y-3 transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
        }`}
      >
        <p className="text-sm text-muted-foreground">
          Import a credit card statement PDF to track spending.
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
        >
          Import statement
        </button>
        <p className="text-xs text-muted-foreground">or drag and drop a PDF here</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={handleFileInput}
          aria-label="Statement PDF"
        />
      </div>

      {importError && (
        <p className="text-sm text-destructive" role="alert">
          {importError}
        </p>
      )}

      {/* Only render analysis sections when there are transactions */}
      {transactions.length > 0 && (
        <>
          {/* Monthly category bars */}
          {monthlyBarData.length > 0 && categorySeries.length > 0 && (
            <section aria-label="Monthly spending by category">
              <BarChartCard
                title="Monthly Spending by Category"
                data={monthlyBarData}
                xKey="month"
                series={categorySeries}
                yFormatter={(v) => `$${v.toLocaleString()}`}
              />
            </section>
          )}

          {/* Current month vs budget + MoM */}
          <section className="grid grid-cols-2 gap-4">
            <div className="border rounded-lg p-4 space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                {summary.currentMonth} spending
              </h2>
              <p className="text-2xl font-semibold">
                ${currentTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              {budget > 0 && (
                <>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${overBudget ? 'bg-destructive' : 'bg-primary'}`}
                      style={{ width: `${budgetPct * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {overBudget
                      ? `$${(currentTotal - budget).toFixed(2)} over budget`
                      : `$${(budget - currentTotal).toFixed(2)} under budget`}{' '}
                    (budget: ${budget.toLocaleString()})
                  </p>
                </>
              )}
            </div>

            <div className="border rounded-lg p-4 space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                Month-to-date vs last month
              </h2>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">This month so far</p>
                <p className="text-2xl font-semibold">
                  ${currentTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Last month (full)</p>
                <p className="text-lg font-medium text-muted-foreground">
                  {summary.previousMonthTotal > 0
                    ? `$${summary.previousMonthTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : 'No prior-month data'}
                </p>
              </div>
              {summary.previousMonthTotal > 0 && (
                <p className={`text-xs ${momDelta === 0 ? 'text-muted-foreground' : momDelta > 0 ? 'text-destructive' : 'text-green-600'}`}>
                  {momDelta === 0
                    ? 'Same as last month so far'
                    : `${momDelta > 0 ? '+' : ''}$${Math.abs(momDelta).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} vs last month's full total (month in progress)`}
                </p>
              )}
            </div>
          </section>

          {/* Money in vs out (last 30 days) */}
          <section>
            <h2 className="text-lg font-medium mb-3">Money in vs out (last 30 days)</h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="border rounded-lg p-4 space-y-1">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Money in</p>
                <p className="text-2xl font-semibold text-emerald-600">
                  ${cashflow.inflow.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-muted-foreground">Estimated from salary</p>
              </div>
              <div className="border rounded-lg p-4 space-y-1">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Money out</p>
                <p className="text-2xl font-semibold">
                  ${cashflow.outflow.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-muted-foreground">Transactions in window</p>
              </div>
              <div className="border rounded-lg p-4 space-y-1">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Net</p>
                <p className={`text-2xl font-semibold ${cashflow.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {cashflow.net >= 0 ? '+' : ''}${cashflow.net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {cashflow.net >= 0 ? 'Surplus' : 'Deficit'}
                </p>
              </div>
            </div>
            {cashflow.outflowByCategory.length > 0 && (
              <ul className="mt-3 space-y-1">
                {cashflow.outflowByCategory
                  .sort((a, b) => b.total - a.total)
                  .map((row) => (
                    <li
                      key={row.categoryId ?? 'null'}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-muted-foreground">
                        {row.categoryId != null
                          ? (categoryById.get(row.categoryId)?.name ?? `Cat ${row.categoryId}`)
                          : 'Uncategorized'}
                      </span>
                      <span>${row.total.toFixed(2)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </section>

          {/* Top merchants */}
          {summary.topMerchants.length > 0 && (
            <section>
              <h2 className="text-lg font-medium mb-3">Top merchants</h2>
              <ul className="space-y-1">
                {summary.topMerchants.map((m) => (
                  <li key={m.merchant} className="flex items-center justify-between text-sm">
                    <span>{m.merchant}</span>
                    <span className="text-muted-foreground">
                      ${m.total.toFixed(2)} · {m.count}×
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Recurring subscriptions */}
          <section>
            <h2 className="text-lg font-medium mb-1">Subscriptions</h2>
            {recurring.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recurring subscriptions detected.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground mb-3">
                  ${recurringTotal.toFixed(2)}/mo across {recurring.length} service{recurring.length !== 1 ? 's' : ''}
                </p>
                <ul className="space-y-1">
                  {recurring.map((g) => (
                    <li key={g.merchant} className="flex items-center justify-between text-sm">
                      <span>{g.merchant}</span>
                      <span className="text-muted-foreground">
                        ${g.averageAmount.toFixed(2)}/mo · {g.occurrences}×
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* Awaiting reimbursement */}
          <section>
            <h2 className="text-lg font-medium mb-3">Awaiting reimbursement</h2>
            {awaitingReimbursement.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending reimbursements.</p>
            ) : (
              <ul className="space-y-2">
                {awaitingReimbursement.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between text-sm border rounded-lg px-4 py-2"
                  >
                    <div>
                      <span className="font-medium">{t.merchant}</span>
                      <span className="ml-2 text-muted-foreground">{t.date}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span>${t.amount.toFixed(2)}</span>
                      <button
                        type="button"
                        onClick={() => setReimbursedTarget(t)}
                        className="text-xs px-2 py-1 border rounded hover:bg-muted"
                      >
                        Mark reimbursed
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* Recent transactions list */}
      <section>
        <h2 className="text-lg font-medium mb-3">Recent transactions</h2>
        {transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No transactions yet. Import a statement to get started.
          </p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Merchant</th>
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {[...transactions]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((t) => (
                  <tr key={t.id} className="border-b">
                    <td className="py-2 pr-4">{t.date}</td>
                    <td className="py-2 pr-4">{t.merchant}</td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {t.categoryId != null
                        ? (categoryById.get(t.categoryId)?.name ?? '—')
                        : '—'}
                    </td>
                    <td className="py-2 text-right">
                      {t.amount < 0 ? (
                        <span className="text-green-600">{t.amount.toFixed(2)}</span>
                      ) : (
                        <span>{t.amount.toFixed(2)}</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Modals */}
      {current && (
        <PdfReviewModal
          result={current.result}
          filename={current.filename}
          existing={transactions}
          onClose={handleModalClose}
          onSaved={handleModalSaved}
        />
      )}
      {reimbursedTarget && (
        <MarkReimbursedDialog
          transaction={reimbursedTarget}
          onClose={() => setReimbursedTarget(null)}
          onConfirmed={() => {
            setReimbursedTarget(null);
            void loadTransactions();
          }}
        />
      )}
    </div>
  );
}
