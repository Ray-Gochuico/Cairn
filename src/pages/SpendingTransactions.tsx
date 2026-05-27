import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeftIcon, PencilIcon, XIcon, CheckIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import DatePicker from '@/components/ui/DatePicker';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useViewFilter } from '@/lib/use-view-filter';
import { filterByPersonId } from '@/lib/filter-by-view';
import type { Transaction } from '@/types/schema';

const selectClass =
  'h-8 w-full rounded-md border border-input bg-transparent px-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

interface RowEditState {
  date: string;
  merchant: string;
  amount: string;
  categoryId: number | null;
  sourceAccountId: number | null;
}

export default function SpendingTransactions() {
  const transactions = useTransactionsStore((s) => s.transactions);
  const loadTransactions = useTransactionsStore((s) => s.load);
  const update = useTransactionsStore((s) => s.update);
  const remove = useTransactionsStore((s) => s.remove);
  const categories = useCategoriesStore((s) => s.categories);
  const loadCategories = useCategoriesStore((s) => s.load);
  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const persons = usePersonsStore((s) => s.persons);
  const loadPersons = usePersonsStore((s) => s.load);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<RowEditState | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { filter } = useViewFilter();

  useEffect(() => {
    void Promise.all([loadTransactions(), loadCategories(), loadAccounts(), loadPersons()]);
  }, [loadTransactions, loadCategories, loadAccounts, loadPersons]);

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

  const startEdit = (t: Transaction) => {
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
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
    setRowError(null);
  };

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

  const handleDelete = async (id: number) => {
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
  };

  return (
    <div className="p-8 space-y-6">
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

      {transactions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No transactions yet. Import a statement from{' '}
          <Link to="/spending" className="underline text-foreground">Spending</Link> to get started.
        </p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transactions match the current view.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-3 w-36">Date</th>
              <th className="py-2 pr-3">Merchant</th>
              <th className="py-2 pr-3">Category</th>
              <th className="py-2 pr-3">Account</th>
              {persons.length === 2 && <th className="py-2 pr-3">Person</th>}
              <th className="py-2 pr-3 text-right w-28">Amount</th>
              <th className="py-2 w-28 text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => {
              const isEditing = t.id != null && editingId === t.id;
              const isConfirmingDelete = t.id != null && confirmingDeleteId === t.id;
              if (isEditing && draft) {
                return (
                  <tr key={t.id} className="border-b align-top bg-muted/30">
                    <td className="py-2 pr-3">
                      <DatePicker
                        id={`edit-date-${t.id}`}
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
                    {persons.length === 2 && (
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
                      {rowError && (
                        <p className="text-xs text-destructive mt-1" role="alert">{rowError}</p>
                      )}
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={t.id} className="border-b">
                  <td className="py-2 pr-3">{t.date}</td>
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
                  {persons.length === 2 && (
                    <td className="py-2 pr-3 text-muted-foreground">
                      {t.personId != null
                        ? (persons.find((p) => p.id === t.personId)?.name ?? '—')
                        : 'Joint'}
                    </td>
                  )}
                  <td className="py-2 pr-3 text-right">
                    {t.amount < 0 ? (
                      <span className="text-success">-${Math.abs(t.amount).toFixed(2)}</span>
                    ) : (
                      <span>${t.amount.toFixed(2)}</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {isConfirmingDelete ? (
                      <div className="inline-flex items-center gap-1">
                        <span className="text-xs text-destructive mr-1">Delete?</span>
                        <button
                          type="button"
                          aria-label={`Confirm delete ${t.merchant}`}
                          onClick={() => t.id != null && void handleDelete(t.id)}
                          disabled={busy}
                          className="text-xs px-2 py-1 rounded border bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-40"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          aria-label="Cancel delete"
                          onClick={() => setConfirmingDeleteId(null)}
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
                          onClick={() => startEdit(t)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border hover:bg-muted"
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${t.merchant}`}
                          onClick={() => t.id != null && setConfirmingDeleteId(t.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border hover:bg-muted text-destructive"
                        >
                          <XIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
