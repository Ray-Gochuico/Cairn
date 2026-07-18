import { useCallback, useState } from 'react';
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
import { EditDrawer } from '@/components/layout/EditDrawer';
import ContributionForm, {
  CONTRIBUTION_SOURCE_LABELS,
  type ContributionFormValues,
} from '@/components/forms/ContributionForm';

/**
 * W14 Manage surface: contribution CRUD on the Investments page. A
 * near-mechanical port of the retired ContributionsTab — same list JSX, store
 * wiring, and delete confirm — with the tab's full-page mode swap replaced by
 * a wide EditDrawer mounting the extracted ContributionForm.
 */
export default function ContributionsPanel() {
  const { contributions, load, create, update, remove, isLoading, error } = useContributionsStore();
  const { accounts, load: loadAccounts, isLoading: accountsLoading, error: accountsError } = useAccountsStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { confirm, dialog } = useConfirm();
  const [drawer, setDrawer] = useState<'closed' | 'create' | { type: 'edit'; id: number }>('closed');

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

  const accountOptions = accounts.map((a) => ({ id: a.id!, name: a.name }));
  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const accountById = new Map(accountOptions.map((a) => [a.id, a.name]));
  const personById = new Map(personOptions.map((p) => [p.id, p.name]));

  // Gate the "Add accounts first." copy on load settlement (W10 M43).
  if (!gate.settled || accounts.length === 0) {
    return (
      <div className="max-w-3xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <p className="text-sm text-muted-foreground">
            Money flowing into your accounts — paychecks, bonuses, manual transfers.
          </p>
          <ImportCsvButton entity="contribution" />
        </div>
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

  const editing = typeof drawer === 'object' ? contributions.find((c) => c.id === drawer.id) : undefined;
  const drawerOpen = drawer === 'create' || editing != null;

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-sm text-muted-foreground">
          Money flowing into your accounts — paychecks, bonuses, manual transfers.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <ImportCsvButton entity="contribution" />
          <Button size="sm" onClick={() => setDrawer('create')}>Add contribution</Button>
        </div>
      </div>

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
                  <Button size="sm" variant="outline" onClick={() => setDrawer({ type: 'edit', id: c.id! })}>Edit</Button>
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

      <div className="mt-4">
        <AddAnnualTotalButton />
      </div>

      <EditDrawer
        open={drawerOpen}
        onClose={() => setDrawer('closed')}
        title={editing ? 'Edit contribution' : 'Add contribution'}
        description={editing ? undefined : 'Money flowing into your accounts — paychecks, bonuses, manual transfers.'}
        wide
      >
        <ContributionForm
          initial={editing ? {
            accountId: editing.accountId,
            personId: editing.personId,
            date: editing.date,
            amount: editing.amount,
            source: editing.source,
          } : defaultContribution}
          accounts={accountOptions}
          persons={personOptions}
          onSubmit={async (v) => {
            if (editing) await update(editing.id!, v); else await create(v);
            setDrawer('closed');
          }}
          onCancel={() => setDrawer('closed')}
        />
      </EditDrawer>
      {dialog}
    </div>
  );
}
