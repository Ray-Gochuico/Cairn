import { useEffect, useState } from 'react';
import { useDependentsStore } from '@/stores/dependents-store';
import { DependentType } from '@/types/enums';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import DependentForm, { DEFAULT_DEPENDENT } from '@/components/forms/DependentForm';

export default function DependentsTab() {
  const { dependents, load, create, update, remove } = useDependentsStore();
  const [mode, setMode] = useState<'list' | 'create' | { type: 'edit'; id: number }>('list');

  useEffect(() => {
    load();
  }, [load]);

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

      {dependents.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          No dependents added yet.
        </div>
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
                  <Button size="sm" variant="destructive" onClick={() => remove(d.id!)}>Delete</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Button onClick={() => setMode('create')}>Add Dependent</Button>
      </div>
    </div>
  );
}
