import { useEffect, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm-dialog';
import EntityCard from './EntityCard';
import SectionEntryGate from './SectionEntryGate';
import HouseholdForm from './forms/HouseholdForm';
import PersonForm from './forms/PersonForm';
import PersonFormImpl from '@/components/forms/PersonForm';
import EmploymentSection from './forms/EmploymentSection';
import DependentForm from './forms/DependentForm';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { SECTIONS, type SectionStatus } from './sections';
import type { Person } from '@/types/schema';

type ActiveDialog = null | 'household' | 'persons' | 'employment' | 'dependents';

interface Props {
  status: SectionStatus;
  onSetStatus: (s: SectionStatus) => void;
}

export default function Section1_WhoYouAre({ status, onSetStatus }: Props) {
  const household = useHouseholdStore((s) => s.household);
  const loadHousehold = useHouseholdStore((s) => s.load);
  const persons = usePersonsStore((s) => s.persons);
  const loadPersons = usePersonsStore((s) => s.load);
  const dependents = useDependentsStore((s) => s.dependents);
  const loadDependents = useDependentsStore((s) => s.load);
  const updatePerson = usePersonsStore((s) => s.update);
  const removePerson = usePersonsStore((s) => s.remove);
  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    if (!household) void loadHousehold();
  }, [household, loadHousehold]);
  useEffect(() => {
    void loadPersons();
  }, [loadPersons]);
  useEffect(() => {
    void loadDependents();
  }, [loadDependents]);

  const meta = SECTIONS[0];

  if (status === 'pending' || status === 'skipped') {
    return (
      <SectionEntryGate
        title={meta.introTitle}
        body={meta.introBody}
        onStart={() => onSetStatus('in_progress')}
        onSkip={() => onSetStatus('skipped')}
        wasSkipped={status === 'skipped'}
      />
    );
  }

  return (
    <div className="space-y-4">
      <EntityCard
        title="Household"
        description="Filing status, state, default assumptions."
        count={household ? 1 : 0}
        onAddManual={() => setDialog('household')}
      />
      <EntityCard
        title="Persons"
        description="You and your partner (one or two adults)."
        count={persons.length}
        onAddManual={() => setDialog('persons')}
      />
      {persons.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="person-chips">
          {persons.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm"
            >
              {p.name || 'Unnamed'}
              <button
                type="button"
                aria-label={`Edit ${p.name}`}
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => setEditingPerson(p)}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Remove ${p.name}`}
                className="rounded-full p-0.5 text-muted-foreground hover:text-destructive-soft-foreground"
                onClick={async () => {
                  const ok = await confirm({
                    title: `Remove ${p.name}?`,
                    description: 'This removes the person from your household setup.',
                  });
                  if (ok && p.id != null) await removePerson(p.id);
                }}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      <EntityCard
        title="Employment"
        description="Salary, bonus, commission for each person."
        count={
          persons.filter(
            (p) =>
              p.annualSalaryPretax > 0 || (p.hourlyRate ?? 0) > 0,
          ).length
        }
        onAddManual={() => setDialog('employment')}
      />
      <EntityCard
        title="Dependents"
        description="Children, parents, or others you support."
        count={dependents.length}
        onAddManual={() => setDialog('dependents')}
      />

      <Dialog
        open={dialog === 'household'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Household</DialogTitle>
            <DialogDescription className="sr-only">
              Set your filing status, state, and household-wide assumptions.
            </DialogDescription>
          </DialogHeader>
          <HouseholdForm onSaved={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'persons'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a person</DialogTitle>
            <DialogDescription className="sr-only">
              Add an earner with their salary and retirement inputs.
            </DialogDescription>
          </DialogHeader>
          <PersonForm onSaved={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={editingPerson !== null}
        onOpenChange={(o) => !o && setEditingPerson(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit person</DialogTitle>
            <DialogDescription className="sr-only">
              Update this person’s salary and retirement inputs.
            </DialogDescription>
          </DialogHeader>
          {editingPerson && (
            <PersonFormImpl
              initial={editingPerson}
              submitLabel="Save changes"
              onSubmit={async (values) => {
                if (editingPerson.id != null) await updatePerson(editingPerson.id, values);
                setEditingPerson(null);
              }}
              onCancel={() => setEditingPerson(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'employment'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Employment</DialogTitle>
            <DialogDescription className="sr-only">
              Set this person’s employment type and pay details.
            </DialogDescription>
          </DialogHeader>
          <EmploymentSection onSaved={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'dependents'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a dependent</DialogTitle>
            <DialogDescription className="sr-only">
              Add a dependent; dependents drive the household HSA limit.
            </DialogDescription>
          </DialogHeader>
          <DependentForm onSaved={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  );
}
