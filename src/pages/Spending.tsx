import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrencyCents, formatDate, formatMonth } from '@/lib/format';
import { useLocalToday } from '@/lib/use-local-today';
import { PageContainer } from '@/components/layout/PageContainer';
import { EmptyState } from '@/components/layout/EmptyState';
import { useLoadGate } from '@/lib/use-load-gate';
import PageLoadingSpinner from '@/components/layout/PageLoadingSpinner';
import { Pencil, Wallet } from 'lucide-react';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { MarkReimbursedDialog } from '@/components/dialogs/MarkReimbursedDialog';
import { TransactionEditDialog } from '@/components/dialogs/TransactionEditDialog';
import BarChartCard from '@/components/charts/BarChartCard';
import MetricCard from '@/components/cards/MetricCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import TransactionsSectionImporter from '@/components/setup/TransactionsSectionImporter';
import { SpendingSummaryHero } from '@/components/spending/SpendingSummaryHero';
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
  isActiveOn,
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
  const transactionsLoading = useTransactionsStore((s) => s.isLoading);
  const syncRecurring = useTransactionsStore((s) => s.syncRecurring);
  const categories = useCategoriesStore((s) => s.categories);
  const loadCategories = useCategoriesStore((s) => s.load);
  const categoriesError = useCategoriesStore((s) => s.error);
  const categoriesLoading = useCategoriesStore((s) => s.isLoading);
  const household = useHouseholdStore((s) => s.household);
  const loadHousehold = useHouseholdStore((s) => s.load);
  const householdError = useHouseholdStore((s) => s.error);
  const householdLoading = useHouseholdStore((s) => s.isLoading);
  const persons = usePersonsStore((s) => s.persons);
  const loadPersons = usePersonsStore((s) => s.load);
  const personsError = usePersonsStore((s) => s.error);
  const personsLoading = usePersonsStore((s) => s.isLoading);
  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);
  const propertiesError = usePropertiesStore((s) => s.error);
  const propertiesLoading = usePropertiesStore((s) => s.isLoading);
  const vehicles = useVehiclesStore((s) => s.vehicles);
  const loadVehicles = useVehiclesStore((s) => s.load);
  const vehiclesError = useVehiclesStore((s) => s.error);
  const vehiclesLoading = useVehiclesStore((s) => s.isLoading);
  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const accountsError = useAccountsStore((s) => s.error);
  const accountsLoading = useAccountsStore((s) => s.isLoading);
  const housingPayments = useHousingPaymentsStore((s) => s.housingPayments);
  const loadHousingPayments = useHousingPaymentsStore((s) => s.load);
  const housingPaymentsError = useHousingPaymentsStore((s) => s.error);
  const housingPaymentsLoading = useHousingPaymentsStore((s) => s.isLoading);
  const vehicleLeases = useVehicleLeasesStore((s) => s.vehicleLeases);
  const loadVehicleLeases = useVehicleLeasesStore((s) => s.load);
  const vehicleLeasesError = useVehicleLeasesStore((s) => s.error);
  const vehicleLeasesLoading = useVehicleLeasesStore((s) => s.isLoading);

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

  // W10 T1: never flash "No transactions yet" while the loads are in flight.
  const gate = useLoadGate(
    [
      transactionsLoading,
      categoriesLoading,
      householdLoading,
      personsLoading,
      propertiesLoading,
      vehiclesLoading,
      accountsLoading,
      housingPaymentsLoading,
      vehicleLeasesLoading,
    ],
    storeErrors,
    reload,
  );

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
      // Wave-9 S79: without these two, a settled reimbursement round-trips
      // as PENDING and silently drops out of every spending total.
      { header: 'reimbursed_at', value: (t) => t.reimbursedAt ?? '' },
      { header: 'reimbursed_amount', value: (t) => t.reimbursedAmount ?? '' },
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
  // Inflow = GROSS pre-tax salary / 12 per visible person (wave-9 F12:
  // labeled as gross in the UI; no surplus verdict is derived from it
  // because outflow is post-tax).
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

  // Recurring total — wave-9 M20: per-month figures (quarterly billers ÷3).
  const recurringTotal = recurring.reduce((s, g) => s + g.monthlyAmount, 0);

  // Recurring obligations (rent + vehicle leases) active today (Wave 11 T10).
  const todayISO = useLocalToday();
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
  // Wave 11 T18: counts + card mount use the same active predicate as the
  // dollar totals — an ended rent/lease no longer inflates the count.
  const activeHousing = useMemo(
    () => housingPayments.filter((h) => isActiveOn(h, todayISO)),
    [housingPayments, todayISO],
  );
  const activeLeases = useMemo(
    () => vehicleLeases.filter((l) => isActiveOn(l, todayISO)),
    [vehicleLeases, todayISO],
  );

  return (
    <PageContainer width="full" className="space-y-8">
      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">Spending</h1>
        <div className="flex items-center gap-2">
          <ExportCsvButton baseName="transactions" columns={csvColumns} rows={transactions} />
        </div>
      </div>

      {/* Glance hero first, chores second. Replaces the old "Current month
          vs budget + MoM" grid (same numbers, new home). Mounts only with
          data — the no-data page stays import-first. */}
      {transactions.length > 0 && (
        <SpendingSummaryHero
          transactions={visibleTransactions}
          categories={categories}
          monthlyBudget={household?.monthlyExpenseBaseline ?? 0}
        />
      )}

      {/* Unified PDF + CSV import surface, extracted so the wizard's Section 4
          can mount the same primitive without duplicating queue logic. */}
      <TransactionsSectionImporter onArchiveWarning={setArchiveWarning} />

      {archiveWarning && (
        <p className="text-sm text-warning-foreground" role="status">
          {archiveWarning}
        </p>
      )}

      {(activeHousing.length > 0 || activeLeases.length > 0) && (
        <section aria-label="Recurring obligations">
          <Card data-testid="spending-recurring-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recurring obligations</CardTitle>
              <CardDescription>Active rent + vehicle leases.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {obligationCurrencyFormatter.format(recurringObligation)}/mo
              </div>
              <div className="mt-3 flex gap-6 border-t pt-3">
                <div>
                  <div className="text-base font-semibold tabular-nums">
                    {obligationCurrencyFormatter.format(housingObligation)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Rent · {activeHousing.length} rental
                    {activeHousing.length === 1 ? '' : 's'}
                  </div>
                </div>
                <div>
                  <div className="text-base font-semibold tabular-nums">
                    {obligationCurrencyFormatter.format(leaseObligation)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Leases · {activeLeases.length} lease
                    {activeLeases.length === 1 ? '' : 's'}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
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
                xTickFormatter={(v) => formatMonth(String(v))}
              />
            </section>
          )}

          {/* Money in vs out (last 30 days) */}
          <section>
            <h2 className="text-lg font-medium mb-3">Money in vs out (last 30 days)</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Wave-9 F12: the inflow is GROSS pre-tax salary while outflow
                  is post-tax spending — labeling the difference "Surplus"/
                  "Deficit" (with a green +) was the lie. Label the numbers as
                  what they are; no verdict. wave-11 handoff: a real take-home
                  inflow could restore a verdict. */}
              <MetricCard
                label="Gross income (est.)"
                value={`$${cashflow.inflow.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                subtitle="Pre-tax salary — taxes not deducted"
              />
              <MetricCard
                label="Money out"
                value={`$${cashflow.outflow.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                subtitle="Transactions in window"
              />
              <MetricCard
                label="Gross minus spending"
                value={`${cashflow.net >= 0 ? '+' : ''}$${cashflow.net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                subtitle="Not take-home surplus — taxes aren't deducted"
              />
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
                      <span>{formatCurrencyCents(row.total)}</span>
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
          <section aria-label="Subscriptions">
            <Card data-testid="spending-subscriptions-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Subscriptions</CardTitle>
                {recurring.length > 0 && (
                  <CardDescription>
                    {formatCurrencyCents(recurringTotal)}/mo across {recurring.length} service
                    {recurring.length !== 1 ? 's' : ''}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {recurring.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recurring subscriptions detected.</p>
                ) : (
                  <ul className="space-y-1">
                    {recurring.map((g) => (
                      <li key={g.merchant} className="flex items-center justify-between text-sm">
                        <span>{g.merchant}</span>
                        <span className="text-muted-foreground">
                          {formatCurrencyCents(g.monthlyAmount)}/mo
                          {g.cadenceMonths > 1 ? ` · every ${g.cadenceMonths} mo` : ''} · {g.occurrences}×
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Awaiting reimbursement */}
          <section aria-label="Awaiting reimbursement">
            <Card data-testid="spending-reimbursement-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Awaiting reimbursement</CardTitle>
              </CardHeader>
              <CardContent>
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
                          <span className="ml-2 text-muted-foreground">{formatDate(t.date)}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span>{formatCurrencyCents(t.amount)}</span>
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
              </CardContent>
            </Card>
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
        {!gate.settled ? (
          // W10 T1: never flash "No transactions yet" while stores load — the
          // drop zone above stays visible so importing is always available.
          <PageLoadingSpinner />
        ) : transactions.length === 0 ? (
          // Data-empty (≠ filter-empty below): canonical EmptyState; no CTA —
          // the importer drop-zone is ON this page, directly above.
          <EmptyState
            bare
            icon={Wallet}
            title="No transactions yet"
            description="Import a statement to get started."
          />
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
                    <td className="py-2 pr-4">{formatDate(t.date)}</td>
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
                        <span className="text-success-foreground">{formatCurrencyCents(t.amount)}</span>
                      ) : (
                        <span>{formatCurrencyCents(t.amount)}</span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <button
                        type="button"
                        aria-label={`Edit ${t.merchant}`}
                        className="text-xs px-2 py-1 border rounded hover:bg-muted"
                        onClick={() => setEditTarget(t)}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
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
