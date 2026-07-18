import { useCallback, useState } from 'react';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLoadGate } from '@/lib/use-load-gate';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { TabLoadingSkeleton } from '@/components/inputs/TabLoadingSkeleton';
import { EditDrawer } from '@/components/layout/EditDrawer';
import AccountForm, {
  ACCOUNT_TYPE_LABELS,
  DEFAULT_ACCOUNT,
} from '@/components/forms/AccountForm';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';

/**
 * W14 Manage surface: account CRUD on the Investments page. A near-mechanical
 * port of the retired AccountsTab — same list JSX, store wiring, and delete
 * confirms — with the tab's full-page mode swap replaced by an EditDrawer.
 * Lives under src/components/ (outside the empty-state ratchet's scan) so its
 * empty copy is gated by discipline via useLoadGate, same as the tab was.
 */
export default function AccountsPanel() {
  const { accounts, load, create, update, remove, isLoading, error } = useAccountsStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { dependents, load: loadDependents } = useDependentsStore();
  const { confirm, dialog } = useConfirm();
  const [drawer, setDrawer] = useState<'closed' | 'create' | { type: 'edit'; id: number }>('closed');

  const reload = useCallback(() => {
    load();
    loadPersons();
    loadDependents();
  }, [load, loadPersons, loadDependents]);
  const gate = useLoadGate([isLoading], [error], reload);

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const dependentOptions = dependents.map((d) => ({ id: d.id!, name: d.name }));
  const personById = new Map(personOptions.map((p) => [p.id, p.name]));

  // Open derives from `editing != null` in edit mode, so an account deleted
  // out from under an open drawer closes it safely (Task-2 recipe).
  const editing = typeof drawer === 'object' ? accounts.find((a) => a.id === drawer.id) : undefined;
  const drawerOpen = drawer === 'create' || editing != null;

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-sm text-muted-foreground">
          Every investment, savings, cash, crypto, and 529 account you want to track.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <ImportCsvButton entity="account" />
          <Button size="sm" onClick={() => setDrawer('create')}>Add account</Button>
        </div>
      </div>

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
                  <Button size="sm" variant="outline" aria-label={`Edit ${a.name}`} onClick={() => setDrawer({ type: 'edit', id: a.id! })}>Edit</Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    aria-label={`Delete ${a.name}`}
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

      <EditDrawer
        open={drawerOpen}
        onClose={() => setDrawer('closed')}
        title={editing ? 'Edit account' : 'Add account'}
        description={editing ? undefined : 'Investment, savings, cash, crypto, and 529 accounts.'}
      >
        <AccountForm
          initial={editing ? {
            householdId: editing.householdId,
            ownerPersonId: editing.ownerPersonId,
            beneficiaryDependentId: editing.beneficiaryDependentId,
            name: editing.name,
            institution: editing.institution,
            type: editing.type,
            cryptoWalletAddress: editing.cryptoWalletAddress,
            autoFetchEnabled: editing.autoFetchEnabled,
            excludedFromNetWorth: editing.excludedFromNetWorth,
            allowMargin: editing.allowMargin,
            stateOfPlan: editing.stateOfPlan,
            accentColor: editing.accentColor,
            apyRate: editing.apyRate,
            hasEmployerMatch: editing.hasEmployerMatch,
            employerMatchPct: editing.employerMatchPct,
            employerMatchLimitPct: editing.employerMatchLimitPct,
            allowsMegaBackdoorRollover: editing.allowsMegaBackdoorRollover,
          } : DEFAULT_ACCOUNT}
          persons={personOptions}
          dependents={dependentOptions}
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
