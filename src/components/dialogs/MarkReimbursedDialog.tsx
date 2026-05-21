import { useState } from 'react';
import DatePicker from '@/components/ui/DatePicker';
import { useTransactionsStore } from '@/stores/transactions-store';
import type { Transaction } from '@/types/schema';

interface MarkReimbursedDialogProps {
  transaction: Transaction;
  onClose: () => void;
  onConfirmed: () => void;
}

export function MarkReimbursedDialog({
  transaction,
  onClose,
  onConfirmed,
}: MarkReimbursedDialogProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState(String(transaction.amount));
  const [date, setDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useTransactionsStore((s) => s.update);

  const handleConfirm = async () => {
    const n = Number(amount);
    if (amount === '' || !Number.isFinite(n) || n < 0) {
      setError('Please enter a non-negative amount.');
      return;
    }
    if (!date) {
      setError('Please select a reimbursed date.');
      return;
    }
    if (transaction.id == null) return;
    setSaving(true);
    setError(null);
    try {
      await update(transaction.id, {
        reimbursedAt: date,
        reimbursedAmount: n,
      });
      onConfirmed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mark transaction as reimbursed"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      {/* Panel */}
      <div className="relative z-10 bg-background rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-semibold">Mark as reimbursed</h2>
        <p className="text-sm text-muted-foreground">
          {transaction.merchant} — ${transaction.amount.toFixed(2)}
        </p>

        <div className="space-y-3">
          <div>
            <label
              htmlFor="reimbursed-amount"
              className="block text-sm font-medium mb-1"
            >
              Reimbursed amount
            </label>
            <input
              id="reimbursed-amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              aria-label="Reimbursed amount"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Reimbursed date
            </label>
            <DatePicker
              id="reimbursed-date"
              value={date}
              onChange={setDate}
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
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
            onClick={handleConfirm}
            disabled={saving || amount === '' || !date}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
