import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as reimbursed</DialogTitle>
          <DialogDescription>
            {transaction.merchant} — ${transaction.amount.toFixed(2)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="reimbursed-amount">Reimbursed amount</Label>
            <Input
              id="reimbursed-amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Reimbursed amount"
            />
          </div>
          <div>
            <Label htmlFor="reimbursed-date">Reimbursed date</Label>
            <DatePicker
              id="reimbursed-date"
              value={date}
              onChange={setDate}
            />
          </div>
          {error && (
            <div className="text-sm text-destructive" role="alert">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={saving || amount === '' || !date}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
