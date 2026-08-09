import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import EntityCard from '@/pages/setup/EntityCard';
import HousingPaymentForm from '@/pages/setup/forms/HousingPaymentForm';
import GateQuestion from '../GateQuestion';
import { GATE_CONFIG } from '../step-registry';
import { useGateAnswer } from './useGateAnswer';
import type { StepComponentProps } from '../step-props';

/** rent_gate — reachable only when visible per D-WF9 (home "no" or rent
 *  rows exist); the Section 2 housing-payment card inline. */
export default function RentGateStep({ ctx, onDirtyChange, submitRef }: StepComponentProps) {
  const { answer, setAnswer, storedStatus, literalAnswer, entityCount, requiredError } = useGateAnswer(
    'rent_gate', ctx, submitRef, onDirtyChange,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const cfg = GATE_CONFIG.rent_gate;
  return (
    <>
      <GateQuestion
        idPrefix="gate-rent"
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
          title="Rent / housing payment"
          description="If you rent your home — recurring monthly $."
          count={ctx.housingPayments.length}
          onAddManual={() => setDialogOpen(true)}
          importEnabled={false}
          items={ctx.housingPayments.map((hp, i) => ({ key: hp.id ?? i, label: hp.name }))}
          manageHref="/property"
          manageLabel="Manage on Property page"
        />
      </GateQuestion>
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add rent / housing payment</DialogTitle>
            <DialogDescription className="sr-only">
              Add a recurring rent or housing payment.
            </DialogDescription>
          </DialogHeader>
          <HousingPaymentForm onSaved={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
