import { useEffect, useMemo, useState } from 'react';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import HoldingForm, { type HoldingFormValues } from '@/components/forms/HoldingForm';

interface Props {
  onComplete: () => void;
}

/**
 * Setup wizard Step 5 — Holdings. Per-account inline editing, mirrors
 * HoldingsTab's row UX. If no accounts exist (user skipped Step 4),
 * shows a gentle prompt and just a Continue button.
 */
export default function Step5Holdings({ onComplete }: Props) {
  const { accounts, load: loadAccounts } = useAccountsStore();
  const { holdings, load: loadHoldings, create, update, remove } = useHoldingsStore();
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  useEffect(() => {
    loadAccounts();
    loadHoldings();
  }, [loadAccounts, loadHoldings]);

  // Default selection to the first account once accounts load.
  useEffect(() => {
    if (selectedAccountId === null && accounts.length > 0 && accounts[0].id != null) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  // If the selected account is removed elsewhere, fall back to the first.
  useEffect(() => {
    if (selectedAccountId !== null && !accounts.some((a) => a.id === selectedAccountId)) {
      setSelectedAccountId(accounts[0]?.id ?? null);
    }
  }, [accounts, selectedAccountId]);

  const accountHoldings = useMemo(
    () => holdings.filter((h) => h.accountId === selectedAccountId),
    [holdings, selectedAccountId]
  );

  if (accounts.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold mb-1">Holdings</h2>
          <p className="text-sm text-muted-foreground">
            Holdings are tickers + share counts inside your investment accounts.
          </p>
        </div>
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          Add accounts in Step 4 to add holdings here. You can also add holdings later from the Inputs page.
        </div>
        <div className="pt-2">
          <Button onClick={onComplete}>Continue</Button>
        </div>
      </div>
    );
  }

  const newRowInitial: HoldingFormValues = {
    accountId: selectedAccountId ?? accounts[0].id!,
    ticker: '',
    shareCount: 0,
    targetAllocationPct: null,
    costBasis: null,
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold mb-1">Holdings</h2>
        <p className="text-sm text-muted-foreground">
          For each investment account, add the tickers and share counts you hold. Skip this step if you only have cash accounts.
        </p>
      </div>

      <div>
        <label htmlFor="accountPicker" className="text-sm font-medium mr-2">
          Account
        </label>
        <select
          id="accountPicker"
          className="inline-flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground uppercase tracking-wider pb-2 border-b">
            <div className="col-span-2">Ticker</div>
            <div className="col-span-2">Shares</div>
            <div className="col-span-2">Target %</div>
            <div className="col-span-2">Cost basis</div>
            <div className="col-span-4 text-right">Actions</div>
          </div>

          {accountHoldings.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground border-b">
              No holdings in this account yet.
            </div>
          ) : (
            accountHoldings.map((h) => (
              <HoldingForm
                key={h.id}
                initial={{
                  accountId: h.accountId,
                  ticker: h.ticker,
                  shareCount: h.shareCount,
                  targetAllocationPct: h.targetAllocationPct,
                  costBasis: h.costBasis,
                }}
                onSave={async (next) => {
                  await update(h.id!, {
                    ticker: next.ticker,
                    shareCount: next.shareCount,
                    targetAllocationPct: next.targetAllocationPct,
                    costBasis: next.costBasis,
                  });
                }}
                onDelete={async () => {
                  await remove(h.id!);
                }}
                saveLabel="Save"
              />
            ))
          )}

          <div className="pt-2">
            <div className="text-xs text-muted-foreground mb-1">Add holding</div>
            <HoldingForm
              key={`new-${selectedAccountId}-${accountHoldings.length}`}
              initial={newRowInitial}
              onSave={async (next) => {
                await create({ ...next, accountId: selectedAccountId ?? accounts[0].id! });
              }}
              saveLabel="Add"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={onComplete}>Continue</Button>
        {holdings.length === 0 && (
          <Button type="button" variant="ghost" onClick={onComplete}>
            Skip — no holdings yet
          </Button>
        )}
      </div>
    </div>
  );
}
