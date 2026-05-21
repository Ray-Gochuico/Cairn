import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DatePicker from '@/components/ui/DatePicker';
import { useTransactionsStore } from '@/stores/transactions-store';
import type { Transaction, Category } from '@/types/schema';

interface TransactionEditDialogProps {
  transaction: Transaction;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export function TransactionEditDialog({
  transaction, categories, onClose, onSaved,
}: TransactionEditDialogProps) {
  const [date, setDate] = useState(transaction.date);
  const [merchant, setMerchant] = useState(transaction.merchant);
  const [amount, setAmount] = useState(String(transaction.amount));
  const [categoryId, setCategoryId] = useState<number | null>(transaction.categoryId);
  const [reimbursable, setReimbursable] = useState(transaction.reimbursable);
  const [notes, setNotes] = useState(transaction.notes ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useTransactionsStore((s) => s.update);
  const remove = useTransactionsStore((s) => s.remove);

  const handleSave = async () => {
    const n = Number(amount);
    if (amount === '' || !Number.isFinite(n)) {
      setError('Please enter a valid amount.');
      return;
    }
    if (!date) { setError('Please select a date.'); return; }
    if (merchant.trim() === '') { setError('Merchant cannot be empty.'); return; }
    if (transaction.id == null) return;
    setSaving(true);
    setError(null);
    try {
      await update(transaction.id, {
        date,
        merchant: merchant.trim(),
        amount: n,
        categoryId,
        reimbursable,
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
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="edit-date">Date</Label>
            <DatePicker id="edit-date" value={date} onChange={setDate} />
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
          <div className="flex items-center gap-2">
            <input id="edit-reimbursable" type="checkbox" aria-label="Reimbursable"
              checked={reimbursable}
              onChange={(e) => setReimbursable(e.target.checked)} />
            <Label htmlFor="edit-reimbursable">Reimbursable</Label>
          </div>
          <div>
            <Label htmlFor="edit-notes">Notes</Label>
            <Input id="edit-notes" aria-label="Notes" value={notes}
              onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && (
            <div className="text-sm text-destructive" role="alert">{error}</div>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          {confirmingDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-destructive">Delete this transaction?</span>
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
              <Button variant="ghost" className="text-destructive"
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
    </Dialog>
  );
}
