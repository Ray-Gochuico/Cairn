import { useEffect, useState } from 'react';
import { usePersonsStore } from '@/stores/persons-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import PersonForm, { DEFAULT_PERSON } from '@/components/forms/PersonForm';

interface Props {
  onComplete: () => void;
}

/**
 * Setup wizard Step 2 — Persons. Multi-instance (1-2 persons). The
 * Continue button is enabled once at least one person has been added.
 */
export default function Step2Persons({ onComplete }: Props) {
  const { persons, load, create, remove } = usePersonsStore();
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-open the form on first arrival so the user sees the fields
  // without having to click "Add Person" first.
  useEffect(() => {
    if (persons.length === 0) {
      setShowForm(true);
    }
  }, [persons.length]);

  const canContinue = persons.length >= 1;
  const canAddMore = persons.length < 2;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold mb-1">Persons</h2>
        <p className="text-sm text-muted-foreground">
          Add yourself, plus a spouse or partner if applicable (up to 2). Used for income, retirement age, and per-person calculators.
        </p>
      </div>

      {persons.length > 0 && (
        <div className="space-y-2">
          {persons.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    DOB: {p.dateOfBirth} · Retire at {p.targetRetirementAge} · Salary ${p.annualSalaryPretax.toLocaleString()}
                  </div>
                </div>
                <Button size="sm" variant="destructive" onClick={() => remove(p.id!)}>
                  Remove
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showForm && canAddMore && (
        <PersonForm
          initial={DEFAULT_PERSON}
          onSubmit={async (v) => {
            await create({ ...v, expectedBonus: 0 });
            setShowForm(false);
          }}
          onCancel={persons.length > 0 ? () => setShowForm(false) : undefined}
          submitLabel="Add Person"
        />
      )}

      {!showForm && canAddMore && (
        <div>
          <Button variant="outline" onClick={() => setShowForm(true)}>
            Add another person
          </Button>
        </div>
      )}

      {!canAddMore && (
        <div className="text-sm text-muted-foreground">
          Maximum of 2 persons reached.
        </div>
      )}

      <div className="pt-2">
        <Button onClick={onComplete} disabled={!canContinue}>
          Continue
        </Button>
        {!canContinue && (
          <p className="text-xs text-muted-foreground mt-1">
            Add at least one person to continue.
          </p>
        )}
      </div>
    </div>
  );
}
