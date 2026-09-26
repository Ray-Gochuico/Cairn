import { useState } from 'react';
import {
  Dialog, DialogContent,
  DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DatePicker from '@/components/ui/DatePicker';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useTransactionsStore } from '@/stores/transactions-store';
import { reimbursementState, reimbursementStatusLine } from '@/lib/reimbursement-status';
import { isRealSpending } from '@/lib/spending-analysis';
import type { Transaction, Category, Property, Vehicle } from '@/types/schema';

interface TransactionEditDialogProps {
  transaction: Transaction;
  categories: Category[];
  properties: Property[];
  vehicles: Vehicle[];
  persons: { id?: number; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export function TransactionEditDialog({
  transaction, categories, properties, vehicles, persons, onClose, onSaved,
}: TransactionEditDialogProps) {
  const [date, setDate] = useState(transaction.date);
  const [merchant, setMerchant] = useState(transaction.merchant);
  const [amount, setAmount] = useState(String(transaction.amount));
  const [categoryId, setCategoryId] = useState<number | null>(transaction.categoryId);
  const [propertyId, setPropertyId] = useState<number | null>(transaction.propertyId);
  const [vehicleId, setVehicleId] = useState<number | null>(transaction.vehicleId);
  const [personId, setPersonId] = useState<number | null>(transaction.personId);
  const [reimbursable, setReimbursable] = useState(transaction.reimbursable);
  const [notes, setNotes] = useState(transaction.notes ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useTransactionsStore((s) => s.update);
  const remove = useTransactionsStore((s) => s.remove);
  const { confirm, dialog: confirmDialog } = useConfirm();
  // R2: the status line reads the SAVED row, never the checkbox's live state.
  const reimbursementStatus = reimbursementStatusLine(transaction);

  const homeParent = categories.find((c) => c.name === 'Home' && c.parentCategoryId === null);
  const vehicleParent = categories.find((c) => c.name === 'Vehicles' && c.parentCategoryId === null);
  const chosen = categories.find((c) => c.id === categoryId);
  const isHome = homeParent != null && chosen?.parentCategoryId === homeParent.id;
  const isVehicle = vehicleParent != null && chosen?.parentCategoryId === vehicleParent.id;

  const handleSave = async () => {
    const n = Number(amount);
    if (amount === '' || !Number.isFinite(n)) {
      setError('Please enter a valid amount.');
      return;
    }
    if (!date) { setError('Please select a date.'); return; }
    if (merchant.trim() === '') { setError('Merchant cannot be empty.'); return; }
    if (transaction.id == null) return;
    // v1.7.1 R10 (D-R10-2): unchecking Reimbursable on a row with a RECORDED
    // reimbursement clears that record, so the save waits for a confirm that
    // names it. Cancel leaves the dialog open and writes nothing.
    if (!reimbursable && reimbursementState(transaction) === 'reimbursed') {
      // The totals sentence is said only when a recorded amount is netted
      // today, by the same rule the totals use (CR-R10-5): the saved row is
      // real spending (isRealSpending — a positive charge outside the
      // Income / Transfer categories) and its recorded amount is > 0
      // (spending-analysis counts amount - reimbursedAmount). A record with
      // no amount or $0 already counts the full amount, and a non-spending
      // row counts in no total, so clearing either moves no total.
      const categoriesById = new Map<number, Category>();
      for (const c of categories) if (c.id != null) categoriesById.set(c.id, c);
      const totalsLine =
        isRealSpending(transaction, categoriesById) && (transaction.reimbursedAmount ?? 0) > 0
          ? ' Spending totals then count its full amount.'
          : '';
      const ok = await confirm({
        title: 'Clear the recorded reimbursement?',
        description: `Unchecking Reimbursable clears the recorded reimbursement: ${reimbursementStatus}${totalsLine}`,
        confirmLabel: 'Clear and save',
      });
      if (!ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      await update(transaction.id, {
        date,
        merchant: merchant.trim(),
        amount: n,
        categoryId,
        propertyId: isHome ? propertyId : null,
        vehicleId: isVehicle ? vehicleId : null,
        personId,
        reimbursable,
        // v1.7.1 R10 (D-R10-3): an unchecked row carries no reimbursement
        // record. A checked row's patch omits both fields, so a recorded
        // reimbursement survives every other edit.
        ...(reimbursable ? {} : { reimbursedAt: null, reimbursedAmount: null }),
        notes: notes.trim() === '' ? null : notes.trim(),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (transaction.id == null) return;
    setSaving(true);
    setError(null);
    try {
      await remove(transaction.id);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit transaction</DialogTitle>
          <DialogDescription className="sr-only">
            Edit the transaction's date, amount, category, and notes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="edit-date">Date</Label>
            <DatePicker id="edit-date" label="Date" value={date} onChange={setDate} />
          </div>
          <div>
            <Label htmlFor="edit-merchant">Merchant</Label>
            <Input id="edit-merchant" aria-label="Merchant" value={merchant}
              onChange={(e) => setMerchant(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="edit-amount">Amount</Label>
            <Input id="edit-amount" aria-label="Amount" type="number" step="0.01"
              value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="edit-category">Category</Label>
            <select id="edit-category" aria-label="Category" className={selectClass}
              value={categoryId ?? ''}
              onChange={(e) =>
                setCategoryId(e.target.value === '' ? null : Number(e.target.value))
              }
            >
              <option value="">— uncategorized —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {isHome && (
            <div>
              <Label htmlFor="edit-property">Property</Label>
              <select id="edit-property" aria-label="Property" className={selectClass}
                value={propertyId ?? ''}
                onChange={(e) =>
                  setPropertyId(e.target.value === '' ? null : Number(e.target.value))
                }
              >
                <option value="">— none —</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
          {isVehicle && (
            <div>
              <Label htmlFor="edit-vehicle">Vehicle</Label>
              <select id="edit-vehicle" aria-label="Vehicle" className={selectClass}
                value={vehicleId ?? ''}
                onChange={(e) =>
                  setVehicleId(e.target.value === '' ? null : Number(e.target.value))
                }
              >
                <option value="">— none —</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
          )}
          {persons.length === 2 && (
            <div>
              <Label htmlFor="edit-person">Person</Label>
              <select id="edit-person" aria-label="Person" className={selectClass}
                value={personId ?? ''}
                onChange={(e) =>
                  setPersonId(e.target.value === '' ? null : Number(e.target.value))
                }
              >
                <option value="">Joint</option>
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            {/* R2 review MINOR 0: the house trio — the status line is the
                checkbox's DESCRIPTION, so it is announced on focus and not
                only to someone reading the dialog linearly. */}
            <input id="edit-reimbursable" type="checkbox" aria-label="Reimbursable"
              checked={reimbursable}
              aria-describedby={reimbursementStatus ? 'edit-reimbursement-status' : undefined}
              onChange={(e) => setReimbursable(e.target.checked)} />
            <Label htmlFor="edit-reimbursable">Reimbursable</Label>
          </div>
          {reimbursementStatus && (
            <p id="edit-reimbursement-status" className="text-xs text-muted-foreground"
              data-testid="edit-reimbursement-status">
              {reimbursementStatus}
            </p>
          )}
          <div>
            <Label htmlFor="edit-notes">Notes</Label>
            <Input id="edit-notes" aria-label="Notes" value={notes}
              onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && (
            <div className="text-sm text-destructive-soft-foreground" role="alert">{error}</div>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          {confirmingDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-destructive-soft-foreground">Delete this transaction?</span>
              <Button variant="destructive" onClick={handleDelete} disabled={saving}>
                Confirm
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingDelete(false)}
                disabled={saving}>
                Keep
              </Button>
            </div>
          ) : (
            <>
              <Button variant="ghost" className="text-destructive-soft-foreground"
                onClick={() => setConfirmingDelete(true)} disabled={saving}>
                Delete
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
      {/* R10: the uncheck confirm (house useConfirm; it portals itself and
          stacks above this dialog, which stays open behind it). */}
      {confirmDialog}
    </Dialog>
  );
}
