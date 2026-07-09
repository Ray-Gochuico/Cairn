import { useCallback, useEffect, useState } from 'react';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLoadGate } from '@/lib/use-load-gate';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { TabLoadingSkeleton } from '@/components/inputs/TabLoadingSkeleton';
import AccountForm, {
  ACCOUNT_TYPE_LABELS,
  DEFAULT_ACCOUNT,
} from '@/components/forms/AccountForm';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';

export default function AccountsTab() {
  const { accounts, load, create, update, remove, isLoading, error } = useAccountsStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { dependents, load: loadDependents } = useDependentsStore();
  const { confirm, dialog } = useConfirm();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  const reload = useCallback(() => {
    load();
    loadPersons();
    loadDependents();
  }, [load, loadPersons, loadDependents]);
  const gate = useLoadGate([isLoading], [error], reload);

  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!accounts.some((a) => a.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, accounts]);

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const dependentOptions = dependents.map((d) => ({ id: d.id!, name: d.name }));
  const personById = new Map(personOptions.map((p) => [p.id, p.name]));

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add account</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Investment, savings, cash, crypto, and 529 accounts.
        </p>
        <AccountForm
          initial={DEFAULT_ACCOUNT}
          persons={personOptions}
          dependents={dependentOptions}
          onSubmit={async (v) => { await create(v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = accounts.find((a) => a.id === mode.id);
    if (!target) {
      // Effect above will reset mode to 'list' on the next tick.
      return null;
    }
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit account</h2>
        <AccountForm
          initial={{
            householdId: target.householdId,
            ownerPersonId: target.ownerPersonId,
            beneficiaryDependentId: target.beneficiaryDependentId,
            name: target.name,
            institution: target.institution,
            type: target.type,
            cryptoWalletAddress: target.cryptoWalletAddress,
            autoFetchEnabled: target.autoFetchEnabled,
            excludedFromNetWorth: target.excludedFromNetWorth,
            allowMargin: target.allowMargin,
            stateOfPlan: target.stateOfPlan,
            accentColor: target.accentColor,
            apyRate: target.apyRate,
          }}
          persons={personOptions}
          dependents={dependentOptions}
          onSubmit={async (v) => { await update(mode.id, v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-start justify-between mb-1">
        <h2 className="text-2xl font-semibold">Accounts</h2>
        <ImportCsvButton entity="account" />
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Every investment, savings, cash, crypto, and 529 account you want to track.
      </p>

      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      {!gate.settled ? (
        <TabLoadingSkeleton />
      ) : accounts.length === 0 ? (
        error == null ? (
          <div className="border rounded-md p-8 text-center text-muted-foreground">
            No accounts added yet.
          </div>
        ) : null
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    {a.allowMargin && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        Margin
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {ACCOUNT_TYPE_LABELS[a.type]}
                    {a.institution ? ` · ${a.institution}` : ''}
                    {' · '}
                    {a.ownerPersonId == null
                      ? 'Joint'
                      : personById.get(a.ownerPersonId) ?? 'Unknown owner'}
                    {a.excludedFromNetWorth ? ' · excluded from net worth' : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setMode({ type: 'edit', id: a.id! })}>Edit</Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete ${a.name}?`,
                        description:
                          'This also permanently deletes its monthly balance snapshots, holdings, and contribution history. This can’t be undone.',
                      });
                      if (ok) await remove(a.id!);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Button onClick={() => setMode('create')}>Add Account</Button>
      </div>
      {dialog}
    </div>
  );
}
