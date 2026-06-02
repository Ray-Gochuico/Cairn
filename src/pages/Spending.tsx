import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { MarkReimbursedDialog } from '@/components/dialogs/MarkReimbursedDialog';
import { TransactionEditDialog } from '@/components/dialogs/TransactionEditDialog';
import BarChartCard from '@/components/charts/BarChartCard';
import TransactionsSectionImporter from '@/components/setup/TransactionsSectionImporter';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { ExportCsvButton } from '@/components/ExportCsvButton';
import { useAccountsStore } from '@/stores/accounts-store';
import type { CsvColumn } from '@/lib/csv';
import { summarizeSpending } from '@/lib/spending-analysis';
import { detectRecurring } from '@/lib/recurring';
import { cashflowWindow } from '@/lib/cashflow';
import {
  monthlyRecurringObligation,
  monthlyHousingObligation,
  monthlyLeaseObligation,
} from '@/lib/recurring-obligations';
import { useViewFilter } from '@/lib/use-view-filter';
import { filterByPersonId } from '@/lib/filter-by-view';
import type { Transaction } from '@/types/schema';

const obligationCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export default function Spending() {
  const [archiveWarning, setArchiveWarning] = useState<string | null>(null);
  const [reimbursedTarget, setReimbursedTarget] = useState<Transaction | null>(null);
  const [editTarget, setEditTarget] = useState<Transaction | null>(null);

  const transactions = useTransactionsStore((s) => s.transactions);
  const loadTransactions = useTransactionsStore((s) => s.load);
  const transactionsError = useTransactionsStore((s) => s.error);
  const syncRecurring = useTransactionsStore((s) => s.syncRecurring);
  const categories = useCategoriesStore((s) => s.categories);
  const loadCategories = useCategoriesStore((s) => s.load);
  const categoriesError = useCategoriesStore((s) => s.error);
  const household = useHouseholdStore((s) => s.household);
  const loadHousehold = useHouseholdStore((s) => s.load);
  const householdError = useHouseholdStore((s) => s.error);
  const persons = usePersonsStore((s) => s.persons);
  const loadPersons = usePersonsStore((s) => s.load);
  const personsError = usePersonsStore((s) => s.error);
  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);
  const propertiesError = usePropertiesStore((s) => s.error);
  const vehicles = useVehiclesStore((s) => s.vehicles);
  const loadVehicles = useVehiclesStore((s) => s.load);
  const vehiclesError = useVehiclesStore((s) => s.error);
  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const accountsError = useAccountsStore((s) => s.error);
  const housingPayments = useHousingPaymentsStore((s) => s.housingPayments);
  const loadHousingPayments = useHousingPaymentsStore((s) => s.load);
  const housingPaymentsError = useHousingPaymentsStore((s) => s.error);
  const vehicleLeases = useVehicleLeasesStore((s) => s.vehicleLeases);
  const loadVehicleLeases = useVehicleLeasesStore((s) => s.load);
  const vehicleLeasesError = useVehicleLeasesStore((s) => s.error);

  const { filter } = useViewFilter();

  // Note: useSettingsStore is consumed via getState() inside handleModalSaved
  // rather than as a subscription. Subscribing here would cause Spending to
  // re-render every time ANY Settings section writes (sidebar overlay, color
  // picks, etc.), which combined with the two BarChartCards on this page
  // tripped React's max-update-depth guard via a recharts internal dispatch
  // loop. Sidebar (always mounted) calls settings.load() on app start, so
  // settings is populated by the time the user reaches Spending.
  const reload = useCallback(() => {
    void Promise.all([
      loadTransactions(),
      loadCategories(),
      loadHousehold(),
      loadPersons(),
      loadProperties(),
      loadVehicles(),
      loadAccounts(),
      loadHousingPayments(),
      loadVehicleLeases(),
    ]).then(() => syncRecurring(useCategoriesStore.getState().categories));
  }, [
    loadTransactions,
    loadCategories,
    loadHousehold,
    loadPersons,
    loadProperties,
    loadVehicles,
    loadAccounts,
    loadHousingPayments,
    loadVehicleLeases,
    syncRecurring,
  ]);
  useEffect(() => {
    reload();
  }, [reload]);

  const storeErrors = [
    transactionsError,
    categoriesError,
    householdError,
    personsError,
    propertiesError,
    vehiclesError,
    accountsError,
    housingPaymentsError,
    vehicleLeasesError,
  ];

  // Filtered slice — honours the ?view=p1|p2|joint|household query param
  const visibleTransactions = useMemo(
    () => filterByPersonId(transactions, filter, persons),
    [transactions, filter, persons],
  );
  const personById = useMemo(
    () => new Map(persons.filter((p) => p.id != null).map((p) => [p.id as number, p.name])),
    [persons],
  );
  const accountById = useMemo(
    () => new Map(accounts.filter((a) => a.id != null).map((a) => [a.id as number, a.name])),
    [accounts],
  );

  // --- Analysis ---
  const summary = useMemo(
    () => summarizeSpending(visibleTransactions, categories),
    [visibleTransactions, categories],
  );
  const recurring = useMemo(() => detectRecurring(visibleTransactions, categories), [visibleTransactions, categories]);

  // Category lookup for display
  const categoryById = useMemo(
    () => new Map(categories.filter((c) => c.id != null).map((c) => [c.id as number, c])),
    [categories],
  );

  // CSV export columns. FK ids resolve to names via the lookup Maps; a null
  // id, or one with no matching row, becomes ''. The exported rows are the
  // full `transactions` array — the ?view filter is intentionally ignored.
  const csvColumns = useMemo<CsvColumn<Transaction>[]>(
    () => [
      { header: 'date', value: (t) => t.date },
      { header: 'merchant', value: (t) => t.merchant },
      { header: 'amount', value: (t) => t.amount },
      {
        header: 'category',
        value: (t) => (t.categoryId != null ? (categoryById.get(t.categoryId)?.name ?? '') : ''),
      },
      {
        header: 'account',
        value: (t) =>
          t.sourceAccountId != null ? (accountById.get(t.sourceAccountId) ?? '') : '',
      },
      {
        header: 'person',
        value: (t) => (t.personId != null ? (personById.get(t.personId) ?? '') : ''),
      },
      { header: 'reimbursable', value: (t) => t.reimbursable },
      { header: 'notes', value: (t) => t.notes },
    ],
    [categoryById, accountById, personById],
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
    () => visibleTransactions.filter((t) => t.reimbursable && t.reimbursedAt == null),
    [visibleTransactions],
  );

  // Rolling 30-day cashflow
  // Inflow = sum of each person's estimated monthly net income.
  // A simple approximation: annualSalaryPretax / 12 (gross); the plan notes
  // exact proration/tax is the implementer's call (design spec § Open questions).
  const visiblePersons = useMemo(
    () => (filter === 'p1' ? persons.slice(0, 1)
      : filter === 'p2' ? persons.slice(1, 2)
      : persons),
    [filter, persons],
  );
  const estimatedMonthlyInflow = useMemo(
    () => visiblePersons.reduce((s, p) => s + p.annualSalaryPretax / 12, 0),
    [visiblePersons],
  );
  const cashflow = useMemo(
    () => cashflowWindow(visibleTransactions, estimatedMonthlyInflow, 30, categories),
    [visibleTransactions, estimatedMonthlyInflow, categories],
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

  // Recurring obligations (rent + vehicle leases) active today.
  const todayISO = new Date().toISOString().slice(0, 10);
  const recurringObligation = useMemo(
    () => monthlyRecurringObligation(housingPayments, vehicleLeases, todayISO),
    [housingPayments, vehicleLeases, todayISO],
  );
  const housingObligation = useMemo(
    () => monthlyHousingObligation(housingPayments, todayISO),
    [housingPayments, todayISO],
  );
  const leaseObligation = useMemo(
    () => monthlyLeaseObligation(vehicleLeases, todayISO),
    [vehicleLeases, todayISO],
  );

  return (
    <PageContainer width="full" className="space-y-8">
      <StoreErrorBanner errors={storeErrors} onRetry={reload} />
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">Spending</h1>
        <div className="flex items-center gap-2">
          <ExportCsvButton baseName="transactions" columns={csvColumns} rows={transactions} />
        </div>
      </div>

      {/* Unified PDF + CSV import surface, extracted so the wizard's Section 4
          can mount the same primitive without duplicating queue logic. */}
      <TransactionsSectionImporter onArchiveWarning={setArchiveWarning} />

      {archiveWarning && (
        <p className="text-sm text-warning-foreground" role="status">
          {archiveWarning}
        </p>
      )}

      {(housingPayments.length > 0 || vehicleLeases.length > 0) && (
        <section aria-label="Recurring obligations">
          <div className="border rounded-lg p-4 space-y-1">
            <h2 className="text-sm font-medium text-muted-foreground">
              Recurring obligations
            </h2>
            <p className="text-xs text-muted-foreground">
              Active rent + vehicle leases.
            </p>
            <div className="text-2xl font-semibold font-mono">
              {obligationCurrencyFormatter.format(recurringObligation)}/mo
            </div>
            <div className="mt-3 flex gap-6 border-t pt-3">
              <div>
                <div className="text-base font-semibold tabular-nums">
                  {obligationCurrencyFormatter.format(housingObligation)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Rent · {housingPayments.length} rental
                  {housingPayments.length === 1 ? '' : 's'}
                </div>
              </div>
              <div>
                <div className="text-base font-semibold tabular-nums">
                  {obligationCurrencyFormatter.format(leaseObligation)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Leases · {vehicleLeases.length} lease
                  {vehicleLeases.length === 1 ? '' : 's'}
                </div>
              </div>
            </div>
          </div>
        </section>
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
                <p className={`text-xs ${momDelta === 0 ? 'text-muted-foreground' : momDelta > 0 ? 'text-destructive' : 'text-success'}`}>
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
                <p className="text-2xl font-semibold text-success">
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
                <p className={`text-2xl font-semibold ${cashflow.net >= 0 ? 'text-success' : 'text-destructive'}`}>
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
            <section aria-label="Top merchants">
              <BarChartCard
                title="Top merchants"
                data={summary.topMerchants.map((m) => ({ merchant: m.merchant, total: m.total }))}
                xKey="merchant"
                series={[{ dataKey: 'total', label: 'Spent' }]}
                yFormatter={(v) => `$${v.toLocaleString()}`}
                layout="vertical"
              />
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
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-medium">Recent transactions</h2>
          {transactions.length > 0 && (
            <Link
              to="/spending/transactions"
              className="text-sm underline text-muted-foreground hover:text-foreground"
            >
              Open all transactions
            </Link>
          )}
        </div>
        {transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No transactions yet. Import a statement to get started.
          </p>
        ) : visibleTransactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions to show.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Merchant</th>
                <th className="py-2 pr-4">Category</th>
                {persons.length === 2 && <th className="py-2 pr-4">Person</th>}
                <th className="py-2 text-right">Amount</th>
                <th className="py-2 pr-2 w-10"><span className="sr-only">Edit</span></th>
              </tr>
            </thead>
            <tbody>
              {[...visibleTransactions]
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 10)
                .map((t) => (
                  <tr key={t.id} className="border-b">
                    <td className="py-2 pr-4">{t.date}</td>
                    <td className="py-2 pr-4">{t.merchant}</td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {t.categoryId != null
                        ? (categoryById.get(t.categoryId)?.name ?? '—')
                        : '—'}
                    </td>
                    {persons.length === 2 && (
                      <td className="py-2 pr-4 text-muted-foreground">
                        {t.personId != null
                          ? (personById.get(t.personId) ?? '—')
                          : 'Joint'}
                      </td>
                    )}
                    <td className="py-2 text-right">
                      {t.amount < 0 ? (
                        <span className="text-success">-${Math.abs(t.amount).toFixed(2)}</span>
                      ) : (
                        <span>${t.amount.toFixed(2)}</span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <button
                        type="button"
                        aria-label={`Edit ${t.merchant}`}
                        className="text-xs px-2 py-1 border rounded hover:bg-muted"
                        onClick={() => setEditTarget(t)}
                      >
                        ✏️
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Modals (PDF + CSV preview modals live inside TransactionsSectionImporter) */}
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
      {editTarget && (
        <TransactionEditDialog
          transaction={editTarget}
          categories={categories}
          properties={properties}
          vehicles={vehicles}
          persons={persons}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            void loadTransactions();
          }}
        />
      )}
    </PageContainer>
  );
}
