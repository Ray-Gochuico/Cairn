import { useMemo, useState } from 'react';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { EditDrawer } from '@/components/layout/EditDrawer';
import AccountForm, {
  DEFAULT_ACCOUNT,
  type AccountFormValues,
} from '@/components/forms/AccountForm';
import { AccountType } from '@/types/enums';
import { get529DeductionForState, UNLIMITED_DEDUCTION_SENTINEL } from '@/lib/529-state-deductions';
import { formatCurrency } from '@/lib/format';

const DEFAULT_529: AccountFormValues = {
  ...DEFAULT_ACCOUNT,
  type: AccountType.ACCOUNT_529,
};

/**
 * "529 college savings" section on the Goals page (W14 one-place-per-thing,
 * 529→Goals decision #3): 529s are college savings toward a dependent's
 * future — a planning surface, not real estate. Lifted from Plan529Tab: the
 * filtered plan list, the state-deduction hint, and Add/Edit via AccountForm
 * preset to `type: ACCOUNT_529` — in the shared EditDrawer.
 *
 * Self-contained: subscribes to accounts/persons/dependents/household/
 * snapshots directly (the tab pattern). It does NOT load stores on mount —
 * the Goals page's reload owns loading (shared-store gate discipline).
 *
 * Empty-state gating: this component lives under src/components/ (outside
 * the empty-state ratchet's scan) so its no-plans state is gated by
 * discipline — it reads the stores' isLoading directly and stays quiet
 * until the loads settle.
 */
export function Plan529Section() {
  const accounts = useAccountsStore((s) => s.accounts);
  const accountsLoading = useAccountsStore((s) => s.isLoading);
  const createAccount = useAccountsStore((s) => s.create);
  const updateAccount = useAccountsStore((s) => s.update);
  const removeAccount = useAccountsStore((s) => s.remove);
  const persons = usePersonsStore((s) => s.persons);
  const dependents = useDependentsStore((s) => s.dependents);
  const dependentsLoading = useDependentsStore((s) => s.isLoading);
  const household = useHouseholdStore((s) => s.household);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [drawer, setDrawer] = useState<'closed' | 'create' | { type: 'edit'; id: number }>('closed');

  const plans = useMemo(
    () => accounts.filter((a) => a.type === AccountType.ACCOUNT_529),
    [accounts],
  );

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const dependentOptions = dependents.map((d) => ({ id: d.id!, name: d.name }));
  const dependentById = useMemo(
    () => new Map(dependents.map((d) => [d.id!, d.name])),
    [dependents],
  );

  // Latest snapshot value per plan (ISO dates compare lexically).
  const latestValueByAccountId = useMemo(() => {
    const winner = new Map<number, { date: string; value: number }>();
    for (const s of snapshots) {
      const prev = winner.get(s.accountId);
      if (!prev || s.snapshotDate > prev.date) {
        winner.set(s.accountId, { date: s.snapshotDate, value: s.totalValue });
      }
    }
    return new Map([...winner.entries()].map(([k, v]) => [k, v.value]));
  }, [snapshots]);

  const deduction = household
    ? get529DeductionForState(household.state, household.filingStatus)
    : null;

  const tooltipBlock = deduction && (
    <div
      role="status"
      className="text-sm rounded-md border border-info/40 bg-info-soft p-3 text-info-foreground"
    >
      Your state ({deduction.state}){' '}
      {deduction.maxAmount === UNLIMITED_DEDUCTION_SENTINEL
        ? 'places no dollar cap on the state income tax deduction for 529 contributions'
        : `allows up to ${formatCurrency(deduction.maxAmount)}/yr state income tax deduction for 529 contributions`}
      . The Supplemental pay calculator doesn't apply this in projections yet.
    </div>
  );

  const settled = !accountsLoading && !dependentsLoading;

  const editing = typeof drawer === 'object' ? plans.find((a) => a.id === drawer.id) : undefined;
  const drawerOpen = drawer === 'create' || editing != null;

  return (
    <section aria-label="529 college savings" className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">529 college savings</h2>
        <Button size="sm" onClick={() => setDrawer('create')}>Add 529 plan</Button>
      </div>
      {tooltipBlock}
      {!settled ? null : plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">No 529 plans yet.</p>
      ) : (
        <div className="space-y-2">
          {plans.map((p) => {
            const latest = p.id != null ? latestValueByAccountId.get(p.id) : undefined;
            return (
              <Card key={p.id}>
                <CardContent className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.institution ? `${p.institution} · ` : ''}
                      {p.beneficiaryDependentId !== null
                        ? `for ${dependentById.get(p.beneficiaryDependentId) ?? 'unknown beneficiary'}`
                        : 'no beneficiary set'}
                      {p.stateOfPlan ? ` · ${p.stateOfPlan}` : ''}
                      {latest != null ? ` · ${formatCurrency(latest)}` : ''}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Edit ${p.name}`}
                    onClick={() => setDrawer({ type: 'edit', id: p.id! })}
                  >
                    Edit
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <EditDrawer
        open={drawerOpen}
        onClose={() => setDrawer('closed')}
        title={drawer === 'create' ? 'Add 529 plan' : 'Edit 529 plan'}
        description={drawer === 'create' ? 'Track college savings accounts for dependents.' : undefined}
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
          } : DEFAULT_529}
          persons={personOptions}
          dependents={dependentOptions}
          onSubmit={async (v) => {
            if (editing) await updateAccount(editing.id!, v); else await createAccount(v);
            setDrawer('closed');
          }}
          onCancel={() => setDrawer('closed')}
        />
        {editing && (
          <div className="mt-6 border-t pt-4">
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete ${editing.name}?`,
                  description:
                    'This also permanently deletes its monthly balance snapshots, holdings, and contribution history. This can’t be undone.',
                });
                if (ok) { await removeAccount(editing.id!); setDrawer('closed'); }
              }}
            >
              Delete 529 plan
            </Button>
          </div>
        )}
      </EditDrawer>
      {confirmDialog}
    </section>
  );
}
