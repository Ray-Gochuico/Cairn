import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import EntityCard from '@/pages/setup/EntityCard';
import GoalForm from '@/pages/setup/forms/GoalForm';
import GateQuestion from '../GateQuestion';
import { GATE_CONFIG } from '../step-registry';
import { useGateAnswer } from './useGateAnswer';
import type { StepComponentProps } from '../step-props';

/** goals_gate — the Section 4 goals card inline. */
export default function GoalsGateStep({ ctx, onDirtyChange, submitRef }: StepComponentProps) {
  const { answer, setAnswer, storedStatus, literalAnswer, entityCount, requiredError } = useGateAnswer(
    'goals_gate', ctx, submitRef, onDirtyChange,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const cfg = GATE_CONFIG.goals_gate;
  return (
    <>
      <GateQuestion
        idPrefix="gate-goals"
        question={cfg.question}
        consequence={cfg.consequence}
        entityCount={entityCount}
        nounSingular={cfg.nounSingular}
        nounPlural={cfg.nounPlural}
        storedStatus={storedStatus}
        answer={answer}
        literalAnswer={literalAnswer}
        showRequiredError={requiredError}
        onAnswer={setAnswer}
      >
        <EntityCard
          title="Goals"
          description="Retirement, education, home, custom."
          count={ctx.goals.length}
          onAddManual={() => setDialogOpen(true)}
          items={ctx.goals.map((g, i) => ({ key: g.id ?? i, label: g.name }))}
          manageHref="/goals"
          manageLabel="Manage on Goals page"
        />
      </GateQuestion>
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a goal</DialogTitle>
            <DialogDescription className="sr-only">
              Add a savings goal with its target amount and date.
            </DialogDescription>
          </DialogHeader>
          <GoalForm onSaved={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
