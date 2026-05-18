import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DatePicker from '@/components/ui/DatePicker';
import { getDatabase } from '@/db/db';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { SnapshotSource } from '@/types/enums';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: number;
  accountName: string;
  onSuccess?: () => void;
}

export function UpdateAccountBalanceDialog({
  open,
  onOpenChange,
  accountId,
  accountName,
  onSuccess,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadSnapshots = useSnapshotsStore((s) => s.load);

  // Reset form state whenever the dialog opens for a new target account.
  useEffect(() => {
    if (open) {
      setAmount('');
      setDate(today);
      setError(null);
      setSubmitting(false);
    }
    // Intentionally only reacting to `open` and `accountId` so re-opens
    // for a different account clear the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId]);

  const handleSubmit = async () => {
    const n = Number(amount);
    if (amount === '' || !Number.isFinite(n) || n < 0) {
      setError('Please enter a non-negative number.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const repo = new AccountSnapshotsRepo(getDatabase());
      await repo.upsert({
        accountId,
        snapshotDate: date,
        totalValue: n,
        source: SnapshotSource.MANUAL,
      });
      await loadSnapshots();
      onSuccess?.();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update {accountName} balance</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="balance-amount">Current balance</Label>
            <Input
              id="balance-amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="balance-date">As of</Label>
            <DatePicker id="balance-date" value={date} onChange={setDate} />
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
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || amount === ''}
          >
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
