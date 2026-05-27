import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { categorize } from '@/lib/categorize';
import { transactionDedupKey, filterDuplicates } from '@/lib/dedup';
import { useCategoriesStore } from '@/stores/categories-store';
import { useMerchantOverridesStore } from '@/stores/merchant-overrides-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { usePersonsStore } from '@/stores/persons-store';
import { MerchantSeedRepo } from '@/domain/merchant-seed';
import { getDatabase } from '@/db/db';
import type { ParseResult } from '@/pdf/parse-statement';
import type { Transaction } from '@/types/schema';

interface PdfReviewModalProps {
  result: ParseResult;
  filename: string;
  fileBytes: Uint8Array;
  existing: Transaction[];
  onClose: () => void;
  onSaved: (insertedCount: number, fileBytes: Uint8Array) => void;
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
  personId: number | null;
  included: boolean;
  isDuplicate: boolean;
}

/**
 * Modal for reviewing transactions parsed from a PDF statement before saving.
 *
 * Wave-5 design A+ #4 / frontend A+ #3: migrated from a hand-rolled
 * `<div role="dialog">` to the shadcn `<Dialog>` wrapper for focus-trap +
 * standard a11y (mirrors the DisclosureModal.tsx pattern). The shadcn
 * wrapper also defaults `aria-describedby` to undefined so the Radix
 * dev-mode "Missing Description" warning stays quiet unless the consumer
 * opts in (we opt in here — the issuer/filename line is a meaningful
 * description for screen readers).
 *
 * The dialog opens once on mount and closes only via Cancel / Save —
 * the parent unmounts on close.
 */
export function PdfReviewModal({
  result,
  filename,
  fileBytes,
  existing,
  onClose,
  onSaved,
}: PdfReviewModalProps) {
  // Store hooks — used for rendering option lists (reactive so selects stay current)
  const categories = useCategoriesStore((s) => s.categories);
  const upsertForMerchant = useMerchantOverridesStore((s) => s.upsertForMerchant);
  const createMany = useTransactionsStore((s) => s.createMany);
  const syncRecurring = useTransactionsStore((s) => s.syncRecurring);
  const properties = usePropertiesStore((s) => s.properties);
  const vehicles = useVehiclesStore((s) => s.vehicles);
  const persons = usePersonsStore((s) => s.persons);

  const [rows, setRows] = useState<EditableRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One-shot row initialisation on mount. We await every store load so we read
  // fresh data via getState() rather than the stale closure values captured by
  // the hooks. After this point, store reloads triggered by save must NOT
  // rebuild rows, or in-modal edits would be lost.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      await Promise.all([
        useCategoriesStore.getState().load(),
        useMerchantOverridesStore.getState().load(),
        usePropertiesStore.getState().load(),
        useVehiclesStore.getState().load(),
        usePersonsStore.getState().load(),
      ]);

      const seedRepo = new MerchantSeedRepo(getDatabase());
      const seeds = await seedRepo.list().catch(() => []);

      if (cancelled) return;

      // Read fresh state now that all loads have settled
      const freshCategories = useCategoriesStore.getState().categories;
      const freshOverrides = useMerchantOverridesStore.getState().overrides;
      const freshProperties = usePropertiesStore.getState().properties;
      const freshVehicles = useVehiclesStore.getState().vehicles;

      const homeParentId = freshCategories.find(
        (c) => c.name === 'Home' && c.parentCategoryId === null,
      )?.id ?? null;
      const vehicleParentId = freshCategories.find(
        (c) => c.name === 'Vehicles' && c.parentCategoryId === null,
      )?.id ?? null;

      function defaultPropertyVehicleFromFresh(
        categoryId: number | null,
      ): { propertyId: number | null; vehicleId: number | null } {
        if (categoryId == null) return { propertyId: null, vehicleId: null };
        const cat = freshCategories.find((c) => c.id === categoryId);
        const isHome = homeParentId != null && cat?.parentCategoryId === homeParentId;
        const isVehicle = vehicleParentId != null && cat?.parentCategoryId === vehicleParentId;
        return {
          propertyId: isHome && freshProperties.length === 1 ? (freshProperties[0].id ?? null) : null,
          vehicleId: isVehicle && freshVehicles.length === 1 ? (freshVehicles[0].id ?? null) : null,
        };
      }

      const { duplicates: dupTransactions } = filterDuplicates(
        result.transactions,
        existing,
      );
      const dupKeys = new Set(dupTransactions.map(transactionDedupKey));

      const built: EditableRow[] = result.transactions.map((t) => {
        const predictedCategoryId = categorize(t.merchant, freshOverrides, seeds);
        const isDuplicate = dupKeys.has(transactionDedupKey(t));
        const { propertyId, vehicleId } = defaultPropertyVehicleFromFresh(predictedCategoryId);
        return {
          date: t.date,
          merchant: t.merchant,
          merchantRaw: t.merchantRaw,
          amount: t.amount,
          categoryId: predictedCategoryId,
          predictedCategoryId,
          reimbursable: false,
          propertyId,
          vehicleId,
          personId: null,
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
    }

    void init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determine which categories are Home or Vehicles children — used for the
  // property/vehicle sub-selects in the render body (reactive so option lists
  // update if the categories store is refreshed while the modal is open).
  const homeParent = categories.find((c) => c.name === 'Home' && c.parentCategoryId === null);
  const vehicleParent = categories.find((c) => c.name === 'Vehicles' && c.parentCategoryId === null);

  /** Returns the propertyId/vehicleId to auto-select for a given categoryId */
  function defaultPropertyVehicle(categoryId: number | null): { propertyId: number | null; vehicleId: number | null } {
    if (categoryId == null) return { propertyId: null, vehicleId: null };
    const cat = categories.find((c) => c.id === categoryId);
    const isHome = homeParent != null && cat?.parentCategoryId === homeParent.id;
    const isVehicle = vehicleParent != null && cat?.parentCategoryId === vehicleParent.id;
    return {
      propertyId: isHome && properties.length === 1 ? (properties[0].id ?? null) : null,
      vehicleId: isVehicle && vehicles.length === 1 ? (vehicles[0].id ?? null) : null,
    };
  }

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
          personId: r.personId,
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

      await syncRecurring(useCategoriesStore.getState().categories);
      onSaved(included.length, fileBytes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const includedCount = rows.filter((r) => r.included).length;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        // Wider than the default max-w-lg to fit the review table. Replace the
        // shadcn default vertical-center grid with a flex column so the body
        // can scroll while the header/footer stay pinned (mirrors the original
        // hand-rolled layout).
        className="max-w-5xl w-[calc(100vw-2rem)] max-h-[90vh] p-0 flex flex-col gap-0 overflow-hidden"
        // Suppress backdrop-click close: in-flight edits are stored only in
        // local state, so a stray click would silently throw work away. The
        // explicit Cancel button is the only outside-of-Save exit.
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 py-4 border-b text-left">
          <DialogTitle>Review transactions</DialogTitle>
          <DialogDescription>
            {result.issuer} · {filename}
          </DialogDescription>
        </DialogHeader>

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
                  {persons.length === 2 && (
                    <th className="py-2 pr-3">Person</th>
                  )}
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
                            <span className="text-xs bg-warning-soft text-warning-foreground px-1 rounded">
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
                              const { propertyId, vehicleId } = defaultPropertyVehicle(val);
                              updateRow(i, { categoryId: val, propertyId, vehicleId });
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
                              // Transfer is seeded as id=41; it is not a Home/Vehicles
                              // category so property/vehicle links must be cleared.
                              const transferCat = categories.find((c) => c.name === 'Transfer');
                              if (transferCat?.id) {
                                updateRow(i, {
                                  categoryId: transferCat.id,
                                  included: true,
                                  propertyId: null,
                                  vehicleId: null,
                                });
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
                            {properties.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
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
                            {vehicles.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                              </option>
                            ))}
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
                      {persons.length === 2 && (
                        <td className="py-2 pr-3">
                          <select
                            value={row.personId ?? ''}
                            aria-label={`Person for ${row.merchant}`}
                            className="border rounded px-1 py-0.5 text-xs"
                            onChange={(e) =>
                              updateRow(i, { personId: e.target.value === '' ? null : Number(e.target.value) })
                            }
                          >
                            <option value="">Joint</option>
                            {persons.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t flex items-center justify-between sm:justify-between">
          <div className="text-sm text-muted-foreground">
            {includedCount} of {rows.length} rows will be saved
          </div>
          <div className="flex items-center gap-3">
            {error && (
              <span className="text-sm text-destructive" role="alert">
                {error}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || includedCount === 0}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
