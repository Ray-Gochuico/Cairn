import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHouseholdStore } from '@/stores/household-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLoadGate } from '@/lib/use-load-gate';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { TabLoadingSkeleton } from '@/components/inputs/TabLoadingSkeleton';
import AccountForm, {
  ACCOUNT_TYPE_LABELS,
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
 * Specialized tab for 529 college-savings plans. Reuses {@link AccountForm}
 * (the same form AccountsTab uses) but pre-selects `type = ACCOUNT_529` so the
 * beneficiary + state-of-plan fields are visible by default. The list view
 * filters to 529 accounts only and shows the beneficiary name + state code as
 * additional context.
 *
 * If the household's resident state appears in the {@link get529DeductionForState}
 * lookup table, a non-blocking blue tooltip surfaces the maximum state income tax
 * deduction for the current filing status. Phase 5 (What-If) will actually wire
 * this number into Bonus Tax projections; Phase 3 only displays it.
 */
export default function Plan529Tab() {
  const { accounts, load, create, update, remove, isLoading: accountsLoading, error: accountsError } = useAccountsStore();
  const { confirm, dialog } = useConfirm();
  const { persons, load: loadPersons } = usePersonsStore();
  const { dependents, load: loadDependents, isLoading: dependentsLoading, error: dependentsError } = useDependentsStore();
  const { household, load: loadHousehold } = useHouseholdStore();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  const reload = useCallback(() => {
    load();
    loadPersons();
    loadDependents();
    loadHousehold();
  }, [load, loadPersons, loadDependents, loadHousehold]);
  const gate = useLoadGate(
    [accountsLoading, dependentsLoading],
    [accountsError, dependentsError],
    reload,
  );

  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!accounts.some((a) => a.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, accounts]);

  const plans = useMemo(
    () => accounts.filter((a) => a.type === AccountType.ACCOUNT_529),
    [accounts],
  );

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const dependentOptions = dependents.map((d) => ({ id: d.id!, name: d.name }));
  const dependentById = new Map(dependentOptions.map((d) => [d.id, d.name]));

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
      . The Bonus Tax calc doesn't apply this in projections yet.
    </div>
  );

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl space-y-4">
        <div>
          <h2 className="text-2xl font-semibold mb-1">Add 529 plan</h2>
          <p className="text-sm text-muted-foreground">
            Track college savings accounts for dependents.
          </p>
        </div>
        {tooltipBlock}
        <AccountForm
          initial={DEFAULT_529}
          persons={personOptions}
          dependents={dependentOptions}
          onSubmit={async (v) => { await create(v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = plans.find((a) => a.id === mode.id);
    if (!target) {
      // Effect above resets mode to 'list' on the next tick.
      return null;
    }
    return (
      <div className="p-6 max-w-2xl space-y-4">
        <h2 className="text-2xl font-semibold mb-1">Edit 529 plan</h2>
        {tooltipBlock}
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
            hasEmployerMatch: target.hasEmployerMatch,
            employerMatchPct: target.employerMatchPct,
            employerMatchLimitPct: target.employerMatchLimitPct,
            allowsMegaBackdoorRollover: target.allowsMegaBackdoorRollover,
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
    <div className="p-6 max-w-3xl space-y-4">
      <div>
        <h2 className="text-2xl font-semibold mb-1">529 Plans</h2>
        <p className="text-sm text-muted-foreground">
          College savings accounts for dependents.
        </p>
      </div>
      {tooltipBlock}
      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      {!gate.settled ? (
        <TabLoadingSkeleton />
      ) : plans.length === 0 ? (
        accountsError == null && dependentsError == null ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              <div className="mb-3">No 529 plans added yet.</div>
              <Button onClick={() => setMode('create')}>Add a 529 plan</Button>
            </CardContent>
          </Card>
        ) : null
      ) : (
        <>
          <div className="flex justify-end">
            <Button onClick={() => setMode('create')}>Add a 529 plan</Button>
          </div>
          <div className="space-y-2">
            {plans.map((p) => (
              <Card key={p.id}>
                <CardContent className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {ACCOUNT_TYPE_LABELS[p.type]}
                      {p.institution ? ` · ${p.institution}` : ''}
                      {p.beneficiaryDependentId !== null
                        ? ` · for ${dependentById.get(p.beneficiaryDependentId) ?? 'unknown beneficiary'}`
                        : ' · no beneficiary set'}
                      {p.stateOfPlan ? ` · ${p.stateOfPlan}` : ''}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setMode({ type: 'edit', id: p.id! })}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Delete ${p.name}?`,
                          description:
                            'This also permanently deletes its monthly balance snapshots, holdings, and contribution history. This can’t be undone.',
                        });
                        if (ok) await remove(p.id!);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
      {dialog}
    </div>
  );
}
