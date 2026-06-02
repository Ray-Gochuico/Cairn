import { useEffect, useMemo, useState } from 'react';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useTickersStore } from '@/stores/tickers-store';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import HoldingForm, { type HoldingFormValues } from '@/components/forms/HoldingForm';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import { enrichTickerIfMissing } from '@/market/ticker-enrichment';
import { YahooClient } from '@/market/yahoo-client';
import { TickersRepo } from '@/domain/tickers';
import { getDatabase } from '@/db/db';
import { validateAccountTargetPct } from '@/lib/holdings-validation';

/**
 * HoldingsTab — pick an account, see its holdings.
 *
 * Editing is per-row with an explicit Save button (cleaner to test than
 * onBlur, and gives the user a calm dirty-aware Save UX matching the
 * rest of Phase 1's input tabs). The "Add holding" affordance is an
 * inline row at the bottom of the table.
 */

export default function HoldingsTab() {
  const { accounts, load: loadAccounts } = useAccountsStore();
  const { holdings, load: loadHoldings, create, update, remove } = useHoldingsStore();
  const loadTickers = useTickersStore((s) => s.load);
  const { confirm, dialog } = useConfirm();
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

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );

  /**
   * Validate that the about-to-be-persisted holding (combined with all
   * other holdings on the same account) does not exceed 100% target
   * allocation, unless the account opts into margin. Pass `editingId =
   * null` for new-row submits, or the existing holding id for edits so
   * the existing row is excluded from the "others" pool.
   */
  const buildValidator = (editingId: number | null) =>
    (next: HoldingFormValues): string | null => {
      const account = accounts.find((a) => a.id === next.accountId);
      if (!account) return null;
      const others = holdings.filter(
        (h) => h.accountId === next.accountId && (editingId === null || h.id !== editingId)
      );
      const proposed = [
        ...others.map((h) => ({ targetAllocationPct: h.targetAllocationPct })),
        { targetAllocationPct: next.targetAllocationPct },
      ];
      const result = validateAccountTargetPct(proposed, { allowMargin: account.allowMargin });
      return result.ok ? null : result.message;
    };

  if (accounts.length === 0) {
    return (
      <div className="p-6 max-w-3xl">
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-2xl font-semibold">Holdings</h2>
          <ImportCsvButton entity="holding" />
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Per-account tickers and share counts. Used by the Investments page and the
          Net Worth chart.
        </p>
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          Add accounts first.
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
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between mb-1">
        <h2 className="text-2xl font-semibold">Holdings</h2>
        <ImportCsvButton entity="holding" />
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Per-account tickers and share counts. Used by the Investments page and the
        Net Worth chart.
      </p>

      <div className="mb-4">
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
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground uppercase tracking-wider pb-2 border-b">
                <div className="col-span-2">Ticker</div>
                <div className="col-span-2">Shares</div>
                <div className="col-span-2">
                  Target %
                  {selectedAccount?.allowMargin && (
                    <span className="ml-1 normal-case tracking-normal text-[10px] text-muted-foreground/80">
                      (margin allowed — sum can exceed 100%)
                    </span>
                  )}
                </div>
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
                      const ok = await confirm({
                        title: `Delete ${h.ticker}?`,
                        description:
                          'This removes the position — its share count, cost basis, and target allocation. This can’t be undone.',
                      });
                      if (ok) await remove(h.id!);
                    }}
                    onValidateSubmit={buildValidator(h.id!)}
                    allowMarginHint={selectedAccount?.allowMargin ?? false}
                    saveLabel="Save"
                  />
                ))
              )}

              <div className="pt-2">
                <div className="text-xs text-muted-foreground mb-1">Add holding</div>
                <HoldingForm
                  // The key resets the form when accounts change so the new-row inputs clear.
                  key={`new-${selectedAccountId}-${accountHoldings.length}`}
                  initial={newRowInitial}
                  onSave={async (next) => {
                    await create({ ...next, accountId: selectedAccountId ?? accounts[0].id! });
                    void (async () => {
                      try {
                        await enrichTickerIfMissing(next.ticker, {
                          yahoo: new YahooClient(),
                          tickers: new TickersRepo(getDatabase()),
                        });
                        await loadTickers();
                      } catch {
                        // best-effort
                      }
                    })();
                  }}
                  onValidateSubmit={buildValidator(null)}
                  allowMarginHint={selectedAccount?.allowMargin ?? false}
                  saveLabel="Add"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      {dialog}
    </div>
  );
}
