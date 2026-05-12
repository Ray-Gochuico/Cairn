import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { HoldingSchema, type Holding } from '@/types/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

/**
 * HoldingsTab — pick an account, see its holdings.
 *
 * Editing is per-row with an explicit Save button (cleaner to test than
 * onBlur, and gives the user a calm dirty-aware Save UX matching the
 * rest of Phase 1's input tabs). The "Add holding" affordance is an
 * inline row at the bottom of the table.
 */

type RowFormValues = Omit<Holding, 'id'>;

const HoldingRowSchema = HoldingSchema.omit({ id: true });

function nullableNumber(v: unknown) {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isNaN(n) ? null : (n as number);
}

interface EditRowProps {
  initial: RowFormValues;
  onSave: (next: RowFormValues) => Promise<void>;
  onDelete?: () => Promise<void>;
  saveLabel: string;
}

function HoldingRow({ initial, onSave, onDelete, saveLabel }: EditRowProps) {
  const form = useForm<RowFormValues>({
    resolver: zodResolver(HoldingRowSchema),
    defaultValues: initial,
  });

  return (
    <form
      onSubmit={form.handleSubmit(async (values) => {
        await onSave(values);
        form.reset(values);
      })}
      className="grid grid-cols-12 gap-2 items-center py-2 border-b last:border-b-0"
    >
      <div className="col-span-2">
        <Input
          aria-label="ticker"
          placeholder="VTI"
          {...form.register('ticker', {
            setValueAs: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
          })}
        />
      </div>
      <div className="col-span-2">
        <Input
          aria-label="shares"
          type="number"
          step="any"
          placeholder="shares"
          {...form.register('shareCount', { valueAsNumber: true })}
        />
      </div>
      <div className="col-span-2">
        <Input
          aria-label="target allocation"
          type="number"
          step="0.01"
          placeholder="0.40"
          {...form.register('targetAllocationPct', { setValueAs: nullableNumber })}
        />
      </div>
      <div className="col-span-2">
        <Input
          aria-label="cost basis"
          type="number"
          step="any"
          placeholder="cost basis"
          {...form.register('costBasis', { setValueAs: nullableNumber })}
        />
      </div>
      <div className="col-span-4 flex justify-end gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={form.formState.isSubmitting || !form.formState.isDirty}
        >
          {saveLabel}
        </Button>
        {onDelete && (
          <Button type="button" size="sm" variant="destructive" onClick={onDelete}>
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}

export default function HoldingsTab() {
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
      <div className="p-6 max-w-3xl">
        <h2 className="text-2xl font-semibold mb-1">Holdings</h2>
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

  const newRowInitial: RowFormValues = {
    accountId: selectedAccountId ?? accounts[0].id!,
    ticker: '',
    shareCount: 0,
    targetAllocationPct: null,
    costBasis: null,
  };

  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-2xl font-semibold mb-1">Holdings</h2>
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
              <HoldingRow
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
            <HoldingRow
              // The key resets the form when accounts change so the new-row inputs clear.
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
    </div>
  );
}
