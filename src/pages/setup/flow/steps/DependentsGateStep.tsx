import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import EntityCard from '@/pages/setup/EntityCard';
import DependentForm from '@/pages/setup/forms/DependentForm';
import GateQuestion from '../GateQuestion';
import { useGateAnswer } from './useGateAnswer';
import type { StepComponentProps } from '../step-props';

/** 1d — CW-21/CW-31a. The gate opens the SAME Dependents card composition
 *  Section 1 uses; the shell maps yes/no → status per D-WF11. */
export default function DependentsGateStep({ ctx, onDirtyChange, submitRef }: StepComponentProps) {
  const { answer, setAnswer, storedStatus, literalAnswer, entityCount, requiredError } = useGateAnswer(
    'dependents_gate', ctx, submitRef, onDirtyChange,
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  const isHoh = ctx.household?.filingStatus === 'HOH';
  const effectiveAnswer = entityCount > 0 ? 'yes' : answer;

  return (
    <>
      <GateQuestion
        idPrefix="gate-dependents"
        question="Do you have children or other dependents?"
        consequence="Nothing is recorded — dependents can be added any time under Inputs → Dependents."
        intro={
          isHoh ? (
            <p className="text-sm" role="note">
              You mentioned supporting a dependent — add them here.
            </p>
          ) : undefined
        }
        entityCount={entityCount}
        nounSingular="dependent"
        nounPlural="dependents"
        storedStatus={storedStatus}
        answer={answer}
        literalAnswer={literalAnswer}
        showRequiredError={requiredError}
        onAnswer={setAnswer}
        extraNote={
          isHoh && effectiveAnswer === 'no' ? (
            <p className="text-sm text-muted-foreground" role="note">
              Your filing status is Head of household — dependents can be added any time
              under Inputs → Dependents.
            </p>
          ) : undefined
        }
      >
        <EntityCard
          title="Dependents"
          description="Children, parents, or others you support."
          count={ctx.dependents.length}
          onAddManual={() => setDialogOpen(true)}
          items={ctx.dependents.map((d, i) => ({ key: d.id ?? i, label: d.name }))}
          manageHref="/inputs/dependents"
          manageLabel="Manage on Setup page"
        />
      </GateQuestion>
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a dependent</DialogTitle>
            <DialogDescription className="sr-only">
              Add a dependent; dependents drive the household HSA limit.
            </DialogDescription>
          </DialogHeader>
          <DependentForm onSaved={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
