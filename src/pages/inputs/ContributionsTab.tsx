import { useCallback, useEffect, useState } from 'react';
import { localTodayISO } from '@/lib/dates';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useLoadGate } from '@/lib/use-load-gate';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { TabLoadingSkeleton } from '@/components/inputs/TabLoadingSkeleton';
import { ContributionSource } from '@/types/enums';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { AddAnnualTotalButton } from '@/components/contributions/AddAnnualTotalButton';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import ContributionForm, {
  CONTRIBUTION_SOURCE_LABELS,
  type ContributionFormValues,
} from '@/components/forms/ContributionForm';

export default function ContributionsTab() {
  const { contributions, load, create, update, remove, isLoading, error } = useContributionsStore();
  const { accounts, load: loadAccounts, isLoading: accountsLoading, error: accountsError } = useAccountsStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { confirm, dialog } = useConfirm();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  const reload = useCallback(() => {
    load();
    loadAccounts();
    loadPersons();
  }, [load, loadAccounts, loadPersons]);
  const gate = useLoadGate(
    [isLoading, accountsLoading],
    [error, accountsError],
    reload,
  );

  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!contributions.some((c) => c.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, contributions]);

  const accountOptions = accounts.map((a) => ({ id: a.id!, name: a.name }));
  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const accountById = new Map(accountOptions.map((a) => [a.id, a.name]));
  const personById = new Map(personOptions.map((p) => [p.id, p.name]));

  // W10 M43: gate the "Add accounts first." copy on load settlement.
  if (!gate.settled || accounts.length === 0) {
    return (
      <div className="p-6 max-w-3xl">
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-2xl font-semibold">Contributions</h2>
          <ImportCsvButton entity="contribution" />
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Money flowing into your accounts — paychecks, bonuses, manual transfers.
        </p>
        <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
        {!gate.settled ? (
          <TabLoadingSkeleton />
        ) : error == null && accountsError == null ? (
          <div className="border rounded-md p-8 text-center text-muted-foreground">
            Add accounts first.
          </div>
        ) : null}
      </div>
    );
  }

  const today = localTodayISO();
  const defaultContribution: ContributionFormValues = {
    accountId: accounts[0].id!,
    personId: persons[0]?.id ?? null,
    date: today,
    amount: 0,
    source: ContributionSource.PAYCHECK,
  };

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add contribution</h2>
        <ContributionForm
          initial={defaultContribution}
          accounts={accountOptions}
          persons={personOptions}
          onSubmit={async (v) => { await create(v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = contributions.find((c) => c.id === mode.id);
    if (!target) {
      // Effect above will reset mode to 'list' on the next tick.
      return null;
    }
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit contribution</h2>
        <ContributionForm
          initial={{
            accountId: target.accountId,
            personId: target.personId,
            date: target.date,
            amount: target.amount,
            source: target.source,
          }}
          accounts={accountOptions}
          persons={personOptions}
          onSubmit={async (v) => { await update(mode.id, v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-start justify-between mb-1">
        <h2 className="text-2xl font-semibold">Contributions</h2>
        <ImportCsvButton entity="contribution" />
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Money flowing into your accounts — paychecks, bonuses, manual transfers.
      </p>

      {contributions.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          No contributions added yet.
        </div>
      ) : (
        <div className="space-y-2">
          {contributions.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">
                    ${c.amount.toLocaleString()} · {accountById.get(c.accountId) ?? `Account #${c.accountId}`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.date} · {CONTRIBUTION_SOURCE_LABELS[c.source]}
                    {c.personId != null && personById.get(c.personId)
                      ? ` · ${personById.get(c.personId)}`
                      : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setMode({ type: 'edit', id: c.id! })}>Edit</Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Delete this contribution?',
                        description: 'This permanently removes the contribution record. This can’t be undone.',
                      });
                      if (ok) await remove(c.id!);
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

      <div className="mt-4 flex items-center gap-2">
        <Button onClick={() => setMode('create')}>Add Contribution</Button>
        <AddAnnualTotalButton />
      </div>
      {dialog}
    </div>
  );
}
