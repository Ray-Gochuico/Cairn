import { useState, useEffect } from 'react';
import {
  Dialog,
  EntryDialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { categorize } from '@/lib/categorize';
import { formatCurrencyCents } from '@/lib/format';
import { filterDuplicates } from '@/lib/dedup';
import { useCategoriesStore } from '@/stores/categories-store';
import { useMerchantOverridesStore } from '@/stores/merchant-overrides-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { usePersonsStore } from '@/stores/persons-store';
import { MerchantSeedRepo } from '@/domain/merchant-seed';
import { getDatabase } from '@/db/db';
import { issuerLabel } from '@/pdf/issuer-label';
import type { ParseResult } from '@/pdf/parse-statement';
import type { Transaction } from '@/types/schema';

interface PdfReviewModalProps {
  result: ParseResult;
  filename: string;
  fileBytes: Uint8Array;
  existing: Transaction[];
  onClose: () => void;
  /** Called once the rows are written. The review stays locked (Save, Cancel,
   *  the X and Escape) until the promise it returns settles: the importer
   *  archives the PDF and moves its queue on there (v1.8.0 W4, PG-4). */
  onSaved: (insertedCount: number, fileBytes: Uint8Array) => void | Promise<void>;
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
 * The dialog opens once on mount; the parent unmounts it on close. Cancel
 * and the X close it at once, and so does Escape until a row is edited;
 * after that Escape asks first (v1.8.0 O2, CR-O-3), because a close here
 * skips the PDF (TransactionsSectionImporter's advance). From Save until the
 * caller's onSaved has settled, nothing closes it and Save stays off
 * (v1.8.0 W4, PG-4): the rows are already written, so a second Save would
 * write them twice, and a close would skip the next queued PDF.
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
  // v1.8.0 O2: any row edit, including the "Exclude (transfer)" button, which
  // fires no input event, so the dialog is told.
  const [rowsEdited, setRowsEdited] = useState(false);
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
      // v1.8.0 W4 (C040): flag exactly the rows filterDuplicates called copies,
      // by identity (the parser emits one object per row). By key, every copy
      // of a charge listed twice was flagged, the one it kept as fresh too.
      const dupRows = new Set(dupTransactions);

      const built: EditableRow[] = result.transactions.map((t) => {
        const predictedCategoryId = categorize(t.merchant, freshOverrides, seeds);
        const isDuplicate = dupRows.has(t);
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
    setRowsEdited(true);
  }

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    let savedCount: number;
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
      savedCount = included.length;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
      return;
    }
    // The rows are written. Stay locked until the caller is done with them
    // (the importer archives the PDF, then moves its queue on), so Save,
    // Cancel, the X and Escape cannot come back in between (PG-4).
    try {
      await onSaved(savedCount, fileBytes);
    } finally {
      setSaving(false);
    }
  };

  const includedCount = rows.filter((r) => r.included).length;
  // v1.8.0 W4 (G2-10 ⚑): the totals of the rows to be saved, to check against
  // the statement's own. Charges are the positive amounts (money spent, the
  // sign convention of src/pdf/types.ts), credits the negative ones, shown as
  // amounts. Summed in whole cents.
  let chargesCents = 0;
  let creditsCents = 0;
  for (const r of rows) {
    if (!r.included) continue;
    const cents = Math.round(r.amount * 100);
    if (cents > 0) chargesCents += cents;
    else creditsCents -= cents;
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // While a save is in flight the X (and Escape) close nothing (PG-4).
        if (!open && !saving) onClose();
      }}
    >
      <EntryDialogContent
        // Wider than the default max-w-lg to fit the review table. Replace the
        // shadcn default vertical-center grid with a flex column so the body
        // can scroll while the header/footer stay pinned (mirrors the original
        // hand-rolled layout).
        className="max-w-5xl w-[calc(100vw-2rem)] max-h-[90vh] p-0 flex flex-col gap-0 overflow-hidden"
        // In-flight edits live only in local state: a backdrop click never
        // closes it (EntryDialogContent), and Escape asks once a row is edited.
        hasEntries={rowsEdited}
        // Mid-save, Escape neither closes the review nor asks (PG-4).
        onEscapeKeyDown={(e) => {
          if (saving) e.preventDefault();
        }}
      >
        <DialogHeader className="px-6 py-4 border-b text-left">
          <DialogTitle>Review transactions</DialogTitle>
          <DialogDescription>
            {issuerLabel(result.issuer)} · {filename}
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
                              // v1.8.0 O2 (O1 chip (d), CR-O-2): a property or vehicle
                              // already picked is kept while the new category is still
                              // in its family (Home, Vehicles); only a change of family
                              // re-defaults it.
                              const next = defaultPropertyVehicle(val);
                              const cat = categories.find((c) => c.id === val);
                              const stillHome = homeParent != null && cat?.parentCategoryId === homeParent.id;
                              const stillVehicle = vehicleParent != null && cat?.parentCategoryId === vehicleParent.id;
                              updateRow(i, {
                                categoryId: val,
                                propertyId: stillHome && row.propertyId != null ? row.propertyId : next.propertyId,
                                vehicleId: stillVehicle && row.vehicleId != null ? row.vehicleId : next.vehicleId,
                              });
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
            {rows.length > 0 && (
              <span>
                Charges {formatCurrencyCents(chargesCents / 100)} · Credits{' '}
                {formatCurrencyCents(creditsCents / 100)} ·{' '}
              </span>
            )}
            <span>
              {includedCount} of {rows.length} rows will be saved
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* Wave-4 a11y: live region mounts EMPTY so SRs announce the
                change to "Saving rows…" when the batch write starts. */}
            <span role="status" data-testid="pdf-save-status" className="sr-only">
              {saving ? 'Saving rows…' : ''}
            </span>
            {error && (
              <span className="text-sm text-destructive-soft-foreground" role="alert">
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
      </EntryDialogContent>
    </Dialog>
  );
}
