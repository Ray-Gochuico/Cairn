import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import EntityCard from '@/pages/setup/EntityCard';
import PropertyForm from '@/pages/setup/forms/PropertyForm';
import GateQuestion from '../GateQuestion';
import { GATE_CONFIG } from '../step-registry';
import { useGateAnswer } from './useGateAnswer';
import type { StepComponentProps } from '../step-props';

/** home_gate — the Section 2 Properties card inline (CW-30c/31c). */
export default function HomeGateStep({ ctx, onDirtyChange, submitRef }: StepComponentProps) {
  const { answer, setAnswer, storedStatus, entityCount } = useGateAnswer(
    'home_gate', ctx, submitRef, onDirtyChange,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const cfg = GATE_CONFIG.home_gate;
  return (
    <>
      <GateQuestion
        idPrefix="gate-home"
        question={cfg.question}
        consequence={cfg.consequence}
        entityCount={entityCount}
        nounSingular={cfg.nounSingular}
        nounPlural={cfg.nounPlural}
        storedStatus={storedStatus}
        answer={answer}
        onAnswer={setAnswer}
      >
        <EntityCard
          title="Properties"
          description="Real estate you own."
          count={ctx.properties.length}
          onAddManual={() => setDialogOpen(true)}
          importEnabled
          importTrigger={<ImportCsvButton entity="property" />}
          items={ctx.properties.map((pr, i) => ({ key: pr.id ?? i, label: pr.name }))}
          manageHref="/property"
          manageLabel="Manage on Property page"
        />
      </GateQuestion>
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a property</DialogTitle>
            <DialogDescription className="sr-only">
              Add a property with its purchase details and estimated value.
            </DialogDescription>
          </DialogHeader>
          <PropertyForm onSaved={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
