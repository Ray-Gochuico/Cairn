import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { formatCurrencyCents, formatDate } from '@/lib/format';
import { useLoadGate } from '@/lib/use-load-gate';
import PageLoadingSpinner from '@/components/layout/PageLoadingSpinner';
import { Link } from 'react-router-dom';
import { useVirtualizer, observeElementRect, observeElementOffset } from '@tanstack/react-virtual';
import { ChevronLeftIcon, PencilIcon, XIcon, CheckIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import DatePicker from '@/components/ui/DatePicker';
import { PageContainer } from '@/components/layout/PageContainer';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { EmptyState } from '@/components/layout/EmptyState';
import { Button } from '@/components/ui/button';
import { Wallet } from 'lucide-react';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useViewFilter } from '@/lib/use-view-filter';
import { filterByPersonId } from '@/lib/filter-by-view';
import type { Transaction, Category } from '@/types/schema';

const selectClass =
  'h-8 w-full rounded-md border border-input bg-transparent px-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

// Tunables for the virtualizer. ROW_HEIGHT is the estimate the virtualizer
// uses to compute offsets — actual heights are measured after mount, so a
// minor mis-estimate just costs one extra scroll-position recalculation.
// OVERSCAN keeps a buffer of rows mounted just outside the viewport so that
// scrolling never reveals an empty placeholder.
const ROW_HEIGHT = 36;
const OVERSCAN = 8;

interface RowEditState {
  date: string;
  merchant: string;
  amount: string;
  categoryId: number | null;
  sourceAccountId: number | null;
}

// Row props are intentionally narrow so React.memo's default shallow compare
// is meaningful — only changes to the row's own transaction or to one of
// the lookup maps trigger a re-render. The maps come from `useMemo`s in the
// parent, so under Task 4's optimistic updates a no-op store touch keeps
// the same reference and no row re-renders.
interface TransactionRowProps {
  t: Transaction;
  categoryById: Map<number, Category>;
  accountById: Map<number, string>;
  persons: Array<{ id?: number | null; name: string }>;
  isConfirmingDelete: boolean;
  busy: boolean;
  onStartEdit: (t: Transaction) => void;
  onAskDelete: (id: number) => void;
  onConfirmDelete: (id: number) => void;
  onCancelDelete: () => void;
  showPersonColumn: boolean;
}

const TransactionRow = memo(function TransactionRow({
  t,
  categoryById,
  accountById,
  persons,
  isConfirmingDelete,
  busy,
  onStartEdit,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
  showPersonColumn,
}: TransactionRowProps) {
  return (
    <tr className="border-b">
      <td className="py-2 pr-3">{formatDate(t.date)}</td>
      <td className="py-2 pr-3">{t.merchant}</td>
      <td className="py-2 pr-3 text-muted-foreground">
        {t.categoryId != null
          ? (categoryById.get(t.categoryId)?.name ?? '—')
          : '—'}
      </td>
      <td className="py-2 pr-3 text-muted-foreground">
        {t.sourceAccountId != null
          ? (accountById.get(t.sourceAccountId) ?? '—')
          : '—'}
      </td>
      {showPersonColumn && (
        <td className="py-2 pr-3 text-muted-foreground">
          {t.personId != null
            ? (persons.find((p) => p.id === t.personId)?.name ?? '—')
            : 'Joint'}
        </td>
      )}
      {/* Wave-12 T4: tabular numerals so amounts align down the column. */}
      <td className="py-2 pr-3 text-right tabular-nums">
        {t.amount < 0 ? (
          <span className="text-success-foreground">{formatCurrencyCents(t.amount)}</span>
        ) : (
          <span>{formatCurrencyCents(t.amount)}</span>
        )}
      </td>
      <td className="py-2 text-right">
        {isConfirmingDelete ? (
          <div className="inline-flex items-center gap-1">
            <span className="text-xs text-destructive-soft-foreground mr-1">Delete?</span>
            <button
              type="button"
              aria-label={`Confirm delete ${t.merchant}`}
              onClick={() => t.id != null && onConfirmDelete(t.id)}
              disabled={busy}
              className="text-xs px-2 py-1 rounded border bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-40"
            >
              Confirm
            </button>
            <button
              type="button"
              aria-label="Cancel delete"
              onClick={onCancelDelete}
              disabled={busy}
              className="text-xs px-2 py-1 rounded border hover:bg-muted disabled:opacity-40"
            >
              Keep
            </button>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              aria-label={`Edit ${t.merchant}`}
              onClick={() => onStartEdit(t)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border hover:bg-muted"
            >
              <PencilIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Delete ${t.merchant}`}
              onClick={() => t.id != null && onAskDelete(t.id)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border hover:bg-muted text-destructive-soft-foreground"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
});

export default function SpendingTransactions() {
  const transactions = useTransactionsStore((s) => s.transactions);
  const loadTransactions = useTransactionsStore((s) => s.load);
  const transactionsError = useTransactionsStore((s) => s.error);
  const transactionsLoading = useTransactionsStore((s) => s.isLoading);
  const update = useTransactionsStore((s) => s.update);
  const remove = useTransactionsStore((s) => s.remove);
  const categories = useCategoriesStore((s) => s.categories);
  const loadCategories = useCategoriesStore((s) => s.load);
  const categoriesError = useCategoriesStore((s) => s.error);
  const categoriesLoading = useCategoriesStore((s) => s.isLoading);
  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const accountsError = useAccountsStore((s) => s.error);
  const accountsLoading = useAccountsStore((s) => s.isLoading);
  const persons = usePersonsStore((s) => s.persons);
  const loadPersons = usePersonsStore((s) => s.load);
  const personsError = usePersonsStore((s) => s.error);
  const personsLoading = usePersonsStore((s) => s.isLoading);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<RowEditState | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { filter } = useViewFilter();

  const reload = useCallback(() => {
    void Promise.all([loadTransactions(), loadCategories(), loadAccounts(), loadPersons()]);
  }, [loadTransactions, loadCategories, loadAccounts, loadPersons]);

  const storeErrors = [transactionsError, categoriesError, accountsError, personsError];
  const hasStoreError = storeErrors.some((e) => e != null);

  // W10 T1: never flash "No transactions yet" while the loads are in flight.
  const gate = useLoadGate(
    [transactionsLoading, categoriesLoading, accountsLoading, personsLoading],
    storeErrors,
    reload,
  );

  const visibleTransactions = useMemo(
    () => filterByPersonId(transactions, filter, persons),
    [transactions, filter, persons],
  );

  const categoryById = useMemo(
    () => new Map(categories.filter((c) => c.id != null).map((c) => [c.id as number, c])),
    [categories],
  );
  const accountById = useMemo(
    () => new Map(accounts.filter((a) => a.id != null).map((a) => [a.id as number, a.name])),
    [accounts],
  );

  const sorted = useMemo(
    () => [...visibleTransactions].sort((a, b) => b.date.localeCompare(a.date)),
    [visibleTransactions],
  );

  // Stable callbacks so TransactionRow's React.memo doesn't break each render.
  const startEdit = useCallback((t: Transaction) => {
    if (t.id == null) return;
    setEditingId(t.id);
    setRowError(null);
    setConfirmingDeleteId(null);
    setDraft({
      date: t.date,
      merchant: t.merchant,
      amount: String(t.amount),
      categoryId: t.categoryId,
      sourceAccountId: t.sourceAccountId,
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setDraft(null);
    setRowError(null);
  }, []);

  const saveEdit = async (id: number) => {
    if (draft == null) return;
    const n = Number(draft.amount);
    if (draft.amount === '' || !Number.isFinite(n)) {
      setRowError('Please enter a valid amount.');
      return;
    }
    if (!draft.date) {
      setRowError('Please select a date.');
      return;
    }
    if (draft.merchant.trim() === '') {
      setRowError('Merchant cannot be empty.');
      return;
    }
    setBusy(true);
    setRowError(null);
    try {
      await update(id, {
        date: draft.date,
        merchant: draft.merchant.trim(),
        amount: n,
        categoryId: draft.categoryId,
        sourceAccountId: draft.sourceAccountId,
      });
      setEditingId(null);
      setDraft(null);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = useCallback(
    async (id: number) => {
      setBusy(true);
      setRowError(null);
      try {
        await remove(id);
        setConfirmingDeleteId(null);
      } catch (e) {
        setRowError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [remove],
  );

  const askDelete = useCallback((id: number) => setConfirmingDeleteId(id), []);
  const cancelDelete = useCallback(() => setConfirmingDeleteId(null), []);

  // Virtualization — only the visible window of rows is mounted to the DOM.
  // Without this, 25 k transactions render 25 k <tr>s and jsdom mount takes
  // 6+ seconds (real WebKit 3-4× worse).
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const showPersonColumn = persons.length === 2;
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    // The currently-edited row uses inline inputs which are taller than a
    // display row, so giving the virtualizer the transaction id as a key
    // lets it preserve measured heights even as the user scrolls and
    // returns. Also keeps row identity stable across optimistic store
    // updates (Task 4).
    getItemKey: (index) => sorted[index]?.id ?? index,
    // Fallback for environments that don't paint layout — primarily jsdom
    // in vitest, where offsetWidth/offsetHeight are always 0. Without this,
    // observeElementRect would clamp the viewport to {0,0} and the
    // virtualizer would render zero rows, breaking every existing test
    // that relies on getByText / getByRole('row'). Real browsers get
    // accurate measurements via the unchanged offset observer.
    observeElementRect: (instance, cb) => {
      const stop = observeElementRect(instance, (rect) => {
        if (rect.height === 0 && rect.width === 0) {
          cb({ width: 1000, height: 800 });
        } else {
          cb(rect);
        }
      });
      return stop;
    },
    observeElementOffset,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  // Padding spacers around the rendered slice — keeps the scrollbar height
  // accurate even though only ~30 rows are in the DOM at any moment.
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <PageContainer width="full" className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link
            to="/spending"
            aria-label="Back to Spending"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-muted"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-semibold">All transactions</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {sorted.length} {sorted.length === 1 ? 'transaction' : 'transactions'}
        </p>
      </div>

      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />

      {/* W10 T5: a failed delete set rowError, but it only rendered inside the
          (unmounted) edit branch — surface it at the list level so a delete
          failure is legible. */}
      {rowError && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive-soft-foreground">
          {rowError}
        </div>
      )}

      {/*
       * Suppress the "No transactions yet" empty copy when a load failed
       * (Frontend H1): an errored load also leaves `transactions` empty, and
       * showing the friendly "import a statement" prompt would wrongly imply
       * the user simply has no data. The banner above explains the failure;
       * here we just render nothing extra until the retry succeeds.
       */}
      {!gate.settled ? (
        <PageLoadingSpinner />
      ) : hasStoreError ? null : transactions.length === 0 ? (
        // Import lives on /spending (there is no /inputs/transactions tab),
        // so the CTA routes there.
        <EmptyState
          bare
          icon={Wallet}
          title="No transactions yet"
          description="Import a statement from Spending to get started."
        >
          <Button asChild size="sm" variant="outline">
            <Link to="/spending">Go to Spending</Link>
          </Button>
        </EmptyState>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transactions match the current view.</p>
      ) : (
        <div
          ref={scrollParentRef}
          className="flex-1 min-h-0 overflow-auto"
          data-testid="transactions-scroll-parent"
        >
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-3 w-36">Date</th>
                <th className="py-2 pr-3">Merchant</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3">Account</th>
                {showPersonColumn && <th className="py-2 pr-3">Person</th>}
                <th className="py-2 pr-3 text-right w-28">Amount</th>
                <th className="py-2 w-28 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {paddingTop > 0 && (
                <tr aria-hidden="true" style={{ height: paddingTop }}>
                  <td colSpan={showPersonColumn ? 7 : 6} />
                </tr>
              )}
              {virtualItems.map((vi) => {
                const t = sorted[vi.index];
                if (!t) return null;
                const isEditing = t.id != null && editingId === t.id;
                const isConfirmingDelete = t.id != null && confirmingDeleteId === t.id;
                if (isEditing && draft) {
                  return (
                    <tr
                      key={vi.key}
                      className="border-b align-top bg-muted/30"
                      ref={virtualizer.measureElement}
                      data-index={vi.index}
                    >
                      <td className="py-2 pr-3">
                        <DatePicker
                          id={`edit-date-${t.id}`}
                          label="Date"
                          value={draft.date}
                          onChange={(v) => setDraft({ ...draft, date: v })}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          aria-label={`Edit merchant for ${t.merchant}`}
                          value={draft.merchant}
                          onChange={(e) => setDraft({ ...draft, merchant: e.target.value })}
                          className="h-8"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <select
                          aria-label={`Edit category for ${t.merchant}`}
                          className={selectClass}
                          value={draft.categoryId ?? ''}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              categoryId: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                        >
                          <option value="">— uncategorized —</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        <select
                          aria-label={`Edit account for ${t.merchant}`}
                          className={selectClass}
                          value={draft.sourceAccountId ?? ''}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              sourceAccountId: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                        >
                          <option value="">— none —</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      </td>
                      {showPersonColumn && (
                        <td className="py-2 pr-3 text-muted-foreground">
                          {t.personId != null ? (persons.find((p) => p.id === t.personId)?.name ?? '—') : 'Joint'}
                        </td>
                      )}
                      <td className="py-2 pr-3 text-right">
                        <Input
                          aria-label={`Edit amount for ${t.merchant}`}
                          type="number"
                          step="0.01"
                          value={draft.amount}
                          onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                          className="h-8 text-right"
                        />
                      </td>
                      <td className="py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            aria-label="Save changes"
                            onClick={() => t.id != null && void saveEdit(t.id)}
                            disabled={busy}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40"
                          >
                            <CheckIcon className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Cancel edit"
                            onClick={cancelEdit}
                            disabled={busy}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40"
                          >
                            <XIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {/* W10 T5: rowError now renders at list level (above) so
                            delete failures — which happen outside this edit row
                            — are visible too. */}
                      </td>
                    </tr>
                  );
                }
                return (
                  <TransactionRow
                    key={vi.key}
                    t={t}
                    categoryById={categoryById}
                    accountById={accountById}
                    persons={persons}
                    isConfirmingDelete={isConfirmingDelete}
                    busy={busy}
                    onStartEdit={startEdit}
                    onAskDelete={askDelete}
                    onConfirmDelete={handleDelete}
                    onCancelDelete={cancelDelete}
                    showPersonColumn={showPersonColumn}
                  />
                );
              })}
              {paddingBottom > 0 && (
                <tr aria-hidden="true" style={{ height: paddingBottom }}>
                  <td colSpan={showPersonColumn ? 7 : 6} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  );
}
