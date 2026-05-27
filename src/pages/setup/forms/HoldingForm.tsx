import { useEffect, useMemo, useState } from 'react';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import HoldingFormImpl, {
  type HoldingFormValues,
} from '@/components/forms/HoldingForm';
import { Label } from '@/components/ui/label';

interface Props {
  onSaved?: () => void;
}

/**
 * Wizard wrapper around the canonical HoldingForm. Adds an account
 * picker on top so the user can choose which account the new holding
 * belongs to (the wizard adds one row at a time across many accounts).
 *
 * Shows a gentle empty-state when no accounts exist (user skipped the
 * Accounts card).
 */
export default function HoldingForm({ onSaved }: Props) {
  const { accounts, load: loadAccounts } = useAccountsStore();
  const create = useHoldingsStore((s) => s.create);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(
    null,
  );

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (selectedAccountId === null && accounts.length > 0 && accounts[0].id != null) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  const initial = useMemo<HoldingFormValues>(
    () => ({
      accountId: selectedAccountId ?? accounts[0]?.id ?? 0,
      ticker: '',
      shareCount: 0,
      targetAllocationPct: null,
      costBasis: null,
    }),
    [selectedAccountId, accounts],
  );

  if (accounts.length === 0) {
    return (
      <div className="border rounded-md p-6 text-sm text-muted-foreground">
        Add an account first (Accounts card above). Holdings live inside
        accounts.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="holding-account-picker">Account</Label>
        <select
          id="holding-account-picker"
          className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={selectedAccountId ?? ''}
          onChange={(e) => setSelectedAccountId(Number(e.target.value))}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <HoldingFormImpl
        key={selectedAccountId ?? 'none'}
        initial={initial}
        onSave={async (next) => {
          await create({
            ...next,
            accountId: selectedAccountId ?? accounts[0].id!,
          });
          onSaved?.();
        }}
        saveLabel="Add holding"
      />
    </div>
  );
}
