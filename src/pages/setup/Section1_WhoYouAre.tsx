import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import EntityCard from './EntityCard';
import SectionEntryGate from './SectionEntryGate';
import HouseholdForm from './forms/HouseholdForm';
import PersonForm from './forms/PersonForm';
import EmploymentSection from './forms/EmploymentSection';
import DependentForm from './forms/DependentForm';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { SECTIONS, type SectionStatus } from './sections';

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
  const [dialog, setDialog] = useState<ActiveDialog>(null);

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
          </DialogHeader>
          <PersonForm onSaved={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'employment'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Employment</DialogTitle>
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
          </DialogHeader>
          <DependentForm onSaved={() => setDialog(null)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
