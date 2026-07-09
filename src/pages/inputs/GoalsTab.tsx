import { useCallback, useEffect, useState } from 'react';
import { useGoalsStore } from '@/stores/goals-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLoadGate } from '@/lib/use-load-gate';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { TabLoadingSkeleton } from '@/components/inputs/TabLoadingSkeleton';
import GoalForm, { DEFAULT_GOAL, GOAL_TYPE_LABELS } from '@/components/forms/GoalForm';
import { formatCurrency } from '@/lib/format';

export default function GoalsTab() {
  const { goals, load, create, update, remove, isLoading, error } = useGoalsStore();
  const { persons, load: loadPersons } = usePersonsStore();
  const { accounts, load: loadAccounts } = useAccountsStore();
  const { confirm, dialog } = useConfirm();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  const reload = useCallback(() => {
    load();
    loadPersons();
    loadAccounts();
  }, [load, loadPersons, loadAccounts]);
  const gate = useLoadGate([isLoading], [error], reload);

  // Defer stale-edit-target reset to a separate effect so we never call
  // setMode during render. If the goal we're editing disappears (e.g. an
  // external delete), drop back to the list before the next paint.
  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!goals.some((g) => g.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, goals]);

  const personOptions = persons.map((p) => ({ id: p.id!, name: p.name }));
  const accountOptions = accounts.map((a) => ({
    id: a.id!,
    name: a.name,
    institution: a.institution,
  }));
  const personById = new Map(personOptions.map((p) => [p.id, p.name]));

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add goal</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Track on/off-track progress toward retirement, down payment, or other targets.
        </p>
        <GoalForm
          initial={DEFAULT_GOAL}
          persons={personOptions}
          accounts={accountOptions}
          onSubmit={async (v) => {
            await create(v);
            setMode('list');
          }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = goals.find((g) => g.id === mode.id);
    if (!target) {
      // Effect above will reset mode to 'list' on the next tick.
      return null;
    }
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit goal</h2>
        <GoalForm
          initial={{
            householdId: target.householdId,
            forPersonId: target.forPersonId,
            name: target.name,
            type: target.type,
            targetAmount: target.targetAmount,
            targetDate: target.targetDate,
            linkedAccountIds: target.linkedAccountIds,
          }}
          persons={personOptions}
          accounts={accountOptions}
          onSubmit={async (v) => {
            await update(mode.id, v);
            setMode('list');
          }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-semibold mb-1">Goals</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Track financial milestones and see whether you're on/off-track based on current contributions.
      </p>

      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      {!gate.settled ? (
        <TabLoadingSkeleton />
      ) : goals.length === 0 ? (
        error == null ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              <div className="mb-3">No goals added yet.</div>
              <Button onClick={() => setMode('create')}>Add a goal</Button>
            </CardContent>
          </Card>
        ) : null
      ) : (
        <>
          <div className="space-y-2">
            {goals.map((g) => (
              <Card key={g.id}>
                <CardContent className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{g.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {GOAL_TYPE_LABELS[g.type]}
                      {' · '}
                      {formatCurrency(g.targetAmount)} by {g.targetDate}
                      {' · '}
                      {g.forPersonId !== null && personById.has(g.forPersonId)
                        ? personById.get(g.forPersonId)
                        : 'Household'}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setMode({ type: 'edit', id: g.id! })}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Delete ${g.name}?`,
                          description: 'This permanently removes this goal. This can’t be undone.',
                        });
                        if (ok) await remove(g.id!);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-4">
            <Button onClick={() => setMode('create')}>Add Goal</Button>
          </div>
        </>
      )}
      {dialog}
    </div>
  );
}
