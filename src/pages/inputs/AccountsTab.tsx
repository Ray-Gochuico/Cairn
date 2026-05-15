import { useEffect, useState } from 'react';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import AccountForm, {
  ACCOUNT_TYPE_LABELS,
  DEFAULT_ACCOUNT,
} from '@/components/forms/AccountForm';

export default function AccountsTab() {
  const { accounts, load, create, update, remove } = useAccountsStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { dependents, load: loadDependents } = useDependentsStore();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  useEffect(() => {
    load();
    loadPersons();
    loadDependents();
  }, [load, loadPersons, loadDependents]);

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
      <h2 className="text-2xl font-semibold mb-1">Accounts</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Every investment, savings, cash, crypto, and 529 account you want to track.
      </p>

      {accounts.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          No accounts added yet.
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{a.name}</div>
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
                  <Button size="sm" variant="destructive" onClick={() => remove(a.id!)}>Delete</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Button onClick={() => setMode('create')}>Add Account</Button>
      </div>
    </div>
  );
}
