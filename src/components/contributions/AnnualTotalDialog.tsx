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
import { useContributionsStore } from '@/stores/contributions-store';
import { ContributionSource } from '@/types/enums';
import type { Contribution } from '@/types/schema';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: ReadonlyArray<{ id: number; name: string }>;
  persons: ReadonlyArray<{ id: number; name: string }>;
}

const CURRENT_YEAR = new Date().getFullYear();

function findExistingAnnualTotal(
  contributions: ReadonlyArray<Contribution>,
  accountId: number,
  year: number,
): Contribution | undefined {
  const date = `${year}-12-31`;
  return contributions.find(
    (c) => c.accountId === accountId
      && c.source === ContributionSource.ANNUAL_TOTAL
      && c.date === date,
  );
}

export function AnnualTotalDialog({ open, onOpenChange, accounts, persons }: Props) {
  const [accountId, setAccountId] = useState<number | ''>('');
  const [year, setYear] = useState<number | ''>(CURRENT_YEAR);
  const [total, setTotal] = useState<string>('');
  const [personId, setPersonId] = useState<number | ''>('');
  const [confirming, setConfirming] = useState<{ existing: Contribution } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contributions = useContributionsStore((s) => s.contributions);
  const create = useContributionsStore((s) => s.create);
  const remove = useContributionsStore((s) => s.remove);

  const reset = () => {
    setAccountId('');
    setYear(CURRENT_YEAR);
    setTotal('');
    setPersonId('');
    setConfirming(null);
    setError(null);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const totalNumber = total === '' ? NaN : Number(total);
  const valid =
    typeof accountId === 'number'
    && typeof year === 'number'
    && Number.isInteger(year)
    && year >= 1900
    && year <= CURRENT_YEAR
    && Number.isFinite(totalNumber)
    && totalNumber > 0;

  const doCreate = async () => {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await create({
        accountId: accountId as number,
        personId: typeof personId === 'number' ? personId : null,
        date: `${year}-12-31`,
        amount: totalNumber,
        source: ContributionSource.ANNUAL_TOTAL,
      });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const existing = findExistingAnnualTotal(contributions, accountId as number, year as number);
    if (existing) {
      setConfirming({ existing });
      return;
    }
    await doCreate();
  };

  const onReplace = async () => {
    if (!confirming?.existing.id) return;
    setSubmitting(true);
    setError(null);
    try {
      await remove(confirming.existing.id);
      await create({
        accountId: accountId as number,
        personId: typeof personId === 'number' ? personId : null,
        date: `${year}-12-31`,
        amount: totalNumber,
        source: ContributionSource.ANNUAL_TOTAL,
      });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Replace failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add annual contribution total</DialogTitle>
          <DialogDescription>
            Records a full-year contribution amount (filed on Dec 31) for an
            account. Use this for retroactive year-end totals when you don't
            have per-month detail.
          </DialogDescription>
        </DialogHeader>

        {confirming ? (
          <div className="space-y-3">
            <p className="text-sm">
              An annual total already exists for this account in {year} (${confirming.existing.amount.toLocaleString()}). Replace it with ${totalNumber.toLocaleString()}?
            </p>
            {error && (
              <div className="text-xs text-destructive-soft-foreground italic bg-destructive/10 border border-destructive/30 rounded p-2">
                {error}
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirming(null)} disabled={submitting}>
                Back
              </Button>
              <Button onClick={onReplace} disabled={submitting}>
                {submitting ? 'Replacing…' : 'Replace'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <Label htmlFor="annual-total-account">Account</Label>
              <select
                id="annual-total-account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full border rounded px-2 py-1 text-sm"
              >
                <option value="">Pick one…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="annual-total-year">Year</Label>
              <Input
                id="annual-total-year"
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value === '' ? '' : Number(e.target.value))}
                min={1900}
                max={CURRENT_YEAR}
              />
            </div>
            <div>
              <Label htmlFor="annual-total-amount">Total ($)</Label>
              <Input
                id="annual-total-amount"
                type="number"
                step="0.01"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="annual-total-person">Person (optional)</Label>
              <select
                id="annual-total-person"
                value={personId}
                onChange={(e) => setPersonId(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full border rounded px-2 py-1 text-sm"
              >
                <option value="">Joint / unattributed</option>
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {error && (
              <div className="text-xs text-destructive-soft-foreground italic bg-destructive/10 border border-destructive/30 rounded p-2">
                {error}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={!valid || submitting}>
                {submitting ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
