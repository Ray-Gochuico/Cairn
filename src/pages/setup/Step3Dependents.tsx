import { useEffect, useState } from 'react';
import { useDependentsStore } from '@/stores/dependents-store';
import { DependentType } from '@/types/enums';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import DependentForm, { DEFAULT_DEPENDENT } from '@/components/forms/DependentForm';

interface Props {
  onComplete: () => void;
}

/**
 * Setup wizard Step 4 — Dependents. Optional, multi-instance. The
 * Continue button is always enabled; a Skip button is offered as an
 * obvious zero-dependents path.
 */
export default function Step3Dependents({ onComplete }: Props) {
  const { dependents, load, create, remove } = useDependentsStore();
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold mb-1">Dependents</h2>
        <p className="text-sm text-muted-foreground">
          Add children or other dependents. Used for 529 plans, childcare expenses, and dependent-care tax credits. This step is optional — skip it if it doesn&apos;t apply.
        </p>
      </div>

      {dependents.length > 0 && (
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
                <Button size="sm" variant="destructive" onClick={() => remove(d.id!)}>
                  Remove
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showForm && (
        <DependentForm
          initial={DEFAULT_DEPENDENT}
          onSubmit={async (v) => {
            await create(v);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
          submitLabel="Add Dependent"
        />
      )}

      {!showForm && (
        <div>
          <Button variant="outline" onClick={() => setShowForm(true)}>
            {dependents.length === 0 ? 'Add a dependent' : 'Add another dependent'}
          </Button>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={onComplete}>Continue</Button>
        {dependents.length === 0 && (
          <Button type="button" variant="ghost" onClick={onComplete}>
            Skip — no dependents
          </Button>
        )}
      </div>
    </div>
  );
}
