import { useCallback, useEffect, useState } from 'react';
import { useDependentsStore } from '@/stores/dependents-store';
import { DependentType } from '@/types/enums';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLoadGate } from '@/lib/use-load-gate';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { TabLoadingSkeleton } from '@/components/inputs/TabLoadingSkeleton';
import DependentForm, { DEFAULT_DEPENDENT } from '@/components/forms/DependentForm';

export default function DependentsTab() {
  const { dependents, load, create, update, remove, isLoading, error } = useDependentsStore();
  const { confirm, dialog } = useConfirm();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  const reload = useCallback(() => {
    load();
  }, [load]);
  const gate = useLoadGate([isLoading], [error], reload);

  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!dependents.some((d) => d.id === mode.id)) {
        setMode('list');
      }
    }
  }, [mode, dependents]);

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Add dependent</h2>
        <DependentForm
          initial={DEFAULT_DEPENDENT}
          onSubmit={async (v) => { await create(v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = dependents.find((d) => d.id === mode.id);
    if (!target) {
      // Effect above will reset mode to 'list' on the next tick.
      return null;
    }
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit dependent</h2>
        <DependentForm
          initial={{
            householdId: target.householdId,
            name: target.name,
            dateOfBirth: target.dateOfBirth,
            type: target.type,
          }}
          onSubmit={async (v) => { await update(mode.id, v); setMode('list'); }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-semibold mb-1">Dependents</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Add children or other dependents. Used for 529 plans, childcare expense tracking, and dependent-care tax credits.
      </p>

      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      {!gate.settled ? (
        <TabLoadingSkeleton />
      ) : dependents.length === 0 ? (
        error == null ? (
          <div className="border rounded-md p-8 text-center text-muted-foreground">
            No dependents added yet.
          </div>
        ) : null
      ) : (
        <div className="space-y-2">
          {dependents.map((d) => (
            <Card key={d.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{d.name}</div>
                  <div className="text-xs text-muted-foreground">
                    DOB: {d.dateOfBirth} · Type: {d.type === DependentType.CHILD ? 'Child' : 'Other'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setMode({ type: 'edit', id: d.id! })}>Edit</Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete ${d.name}?`,
                        description:
                          'This removes the dependent and unlinks them from any account they’re a beneficiary of. This can’t be undone.',
                      });
                      if (ok) await remove(d.id!);
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
        <Button onClick={() => setMode('create')}>Add Dependent</Button>
      </div>
      {dialog}
    </div>
  );
}
