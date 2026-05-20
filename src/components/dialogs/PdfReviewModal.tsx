import { useState, useEffect } from 'react';
import { categorize } from '@/lib/categorize';
import { transactionDedupKey, filterDuplicates } from '@/lib/dedup';
import { useCategoriesStore } from '@/stores/categories-store';
import { useMerchantOverridesStore } from '@/stores/merchant-overrides-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { MerchantSeedRepo } from '@/domain/merchant-seed';
import { getDatabase } from '@/db/db';
import type { ParseResult } from '@/pdf/parse-statement';
import type { Transaction, MerchantSeed } from '@/types/schema';

interface PdfReviewModalProps {
  result: ParseResult;
  filename: string;
  existing: Transaction[];
  onClose: () => void;
  onSaved: (insertedCount: number) => void;
}

interface EditableRow {
  date: string;
  merchant: string;
  merchantRaw: string;
  amount: number;
  categoryId: number | null;
  predictedCategoryId: number | null;
  reimbursable: boolean;
  propertyId: number | null;
  vehicleId: number | null;
  included: boolean;
  isDuplicate: boolean;
}

export function PdfReviewModal({
  result,
  filename,
  existing,
  onClose,
  onSaved,
}: PdfReviewModalProps) {
  const categories = useCategoriesStore((s) => s.categories);
  const loadCategories = useCategoriesStore((s) => s.load);
  const overrides = useMerchantOverridesStore((s) => s.overrides);
  const loadOverrides = useMerchantOverridesStore((s) => s.load);
  const upsertForMerchant = useMerchantOverridesStore((s) => s.upsertForMerchant);
  const createMany = useTransactionsStore((s) => s.createMany);

  const [rows, setRows] = useState<EditableRow[]>([]);
  const [seeds, setSeeds] = useState<MerchantSeed[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load categories, overrides, and seeds on mount
  useEffect(() => {
    loadCategories();
    loadOverrides();
    const repo = new MerchantSeedRepo(getDatabase());
    repo.list().then(setSeeds).catch(() => setSeeds([]));
  }, [loadCategories, loadOverrides]);

  // Build editable rows once we have categories + overrides + seeds
  useEffect(() => {
    if (categories.length === 0) return;

    const { duplicates: dupTransactions } = filterDuplicates(
      result.transactions,
      existing,
    );
    const dupKeys = new Set(dupTransactions.map(transactionDedupKey));

    const built: EditableRow[] = result.transactions.map((t) => {
      const predictedCategoryId = categorize(t.merchant, overrides, seeds);
      const isDuplicate = dupKeys.has(transactionDedupKey(t));
      return {
        date: t.date,
        merchant: t.merchant,
        merchantRaw: t.merchantRaw,
        amount: t.amount,
        categoryId: predictedCategoryId,
        predictedCategoryId,
        reimbursable: false,
        propertyId: null,
        vehicleId: null,
        included: !isDuplicate,
        isDuplicate,
      };
    });
    // Keep fresh ones first for easier review
    built.sort((a, b) => {
      if (a.isDuplicate && !b.isDuplicate) return 1;
      if (!a.isDuplicate && b.isDuplicate) return -1;
      return a.date.localeCompare(b.date);
    });
    setRows(built);
  // Intentionally re-run when categories/overrides/seeds arrive
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, overrides, seeds]);

  function updateRow(index: number, patch: Partial<EditableRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const included = rows.filter((r) => r.included);
      const toInsert = included.map(
        (r): Omit<Transaction, 'id'> => ({
          householdId: 1,
          date: r.date,
          merchant: r.merchant,
          merchantRaw: r.merchantRaw || null,
          amount: r.amount,
          categoryId: r.categoryId,
          sourceAccountId: null,
          propertyId: r.propertyId,
          vehicleId: r.vehicleId,
          sourcePdfFilename: filename,
          reimbursable: r.reimbursable,
          reimbursedAt: null,
          reimbursedAmount: null,
          isRecurring: false,
          notes: null,
        }),
      );
      await createMany(toInsert);

      // For any row whose categoryId differs from predictedCategoryId, write an override
      for (const r of included) {
        if (r.categoryId != null && r.categoryId !== r.predictedCategoryId) {
          await upsertForMerchant(1, r.merchant, r.categoryId);
        }
      }

      onSaved(included.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Determine which categories are Home (parentId=1) or Vehicles (parentId=2) children
  // The seeded data uses id=1 for Home and id=2 for Vehicles as parent categories
  const homeParent = categories.find((c) => c.name === 'Home' && c.parentCategoryId === null);
  const vehicleParent = categories.find((c) => c.name === 'Vehicles' && c.parentCategoryId === null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Review transactions from ${filename}`}
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      {/* Panel */}
      <div className="relative z-10 bg-background rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">Review transactions</h2>
            <p className="text-sm text-muted-foreground">
              {result.issuer} · {filename}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No transactions found.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3 w-8">
                    <span className="sr-only">Include</span>
                  </th>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Merchant</th>
                  <th className="py-2 pr-3">Amount</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Reimbursable</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isHome = row.categoryId != null &&
                    homeParent != null &&
                    categories.find((c) => c.id === row.categoryId)?.parentCategoryId === homeParent.id;
                  const isVehicle = row.categoryId != null &&
                    vehicleParent != null &&
                    categories.find((c) => c.id === row.categoryId)?.parentCategoryId === vehicleParent.id;

                  return (
                    <tr
                      key={i}
                      className={`border-b ${row.isDuplicate ? 'opacity-60' : ''}`}
                    >
                      <td className="py-2 pr-3">
                        <input
                          type="checkbox"
                          aria-label={`Include ${row.merchant}`}
                          checked={row.included}
                          onChange={(e) => updateRow(i, { included: e.target.checked })}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="date"
                          value={row.date}
                          aria-label={`Date for ${row.merchant}`}
                          className="border rounded px-1 py-0.5 text-xs w-32"
                          onChange={(e) => updateRow(i, { date: e.target.value })}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={row.merchant}
                            aria-label={`Merchant name for row ${i + 1}`}
                            className="border rounded px-1 py-0.5 text-xs w-36"
                            onChange={(e) => updateRow(i, { merchant: e.target.value })}
                          />
                          {row.isDuplicate && (
                            <span className="text-xs bg-yellow-100 text-yellow-800 px-1 rounded">
                              duplicate
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          step="0.01"
                          value={row.amount}
                          aria-label={`Amount for ${row.merchant}`}
                          className="border rounded px-1 py-0.5 text-xs w-24"
                          onChange={(e) => updateRow(i, { amount: Number(e.target.value) })}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1">
                          <select
                            value={row.categoryId ?? ''}
                            aria-label={`Category for ${row.merchant}`}
                            className="border rounded px-1 py-0.5 text-xs"
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : Number(e.target.value);
                              updateRow(i, { categoryId: val, propertyId: null, vehicleId: null });
                            }}
                          >
                            <option value="">— uncategorized —</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                          {/* Exclude as transfer */}
                          <button
                            type="button"
                            title="Exclude (transfer)"
                            className="text-xs text-muted-foreground hover:text-foreground"
                            aria-label={`Exclude transfer for ${row.merchant}`}
                            onClick={() => {
                              // Transfer is seeded as id=41
                              const transferCat = categories.find((c) => c.name === 'Transfer');
                              if (transferCat?.id) {
                                updateRow(i, { categoryId: transferCat.id, included: true });
                              }
                            }}
                          >
                            ⟷
                          </button>
                        </div>
                        {/* Property sub-select */}
                        {isHome && (
                          <select
                            value={row.propertyId ?? ''}
                            aria-label={`Property for ${row.merchant}`}
                            className="mt-1 border rounded px-1 py-0.5 text-xs"
                            onChange={(e) =>
                              updateRow(i, { propertyId: e.target.value === '' ? null : Number(e.target.value) })
                            }
                          >
                            <option value="">— property —</option>
                          </select>
                        )}
                        {/* Vehicle sub-select */}
                        {isVehicle && (
                          <select
                            value={row.vehicleId ?? ''}
                            aria-label={`Vehicle for ${row.merchant}`}
                            className="mt-1 border rounded px-1 py-0.5 text-xs"
                            onChange={(e) =>
                              updateRow(i, { vehicleId: e.target.value === '' ? null : Number(e.target.value) })
                            }
                          >
                            <option value="">— vehicle —</option>
                          </select>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="checkbox"
                          aria-label={`Reimbursable for ${row.merchant}`}
                          checked={row.reimbursable}
                          onChange={(e) => updateRow(i, { reimbursable: e.target.checked })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {rows.filter((r) => r.included).length} of {rows.length} rows will be saved
          </div>
          <div className="flex items-center gap-3">
            {error && (
              <span className="text-sm text-destructive" role="alert">
                {error}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm border rounded hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || rows.filter((r) => r.included).length === 0}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
