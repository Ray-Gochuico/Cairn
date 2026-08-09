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
import LoanForm from '@/pages/setup/forms/LoanForm';
import GateQuestion from '../GateQuestion';
import { GATE_CONFIG } from '../step-registry';
import { useGateAnswer } from './useGateAnswer';
import type { StepComponentProps } from '../step-props';

/** loans_gate — CW-32 no-judgment intro + the Section 3 loans card inline
 *  (the all-required LoanForm with amortize auto-fill — never worded
 *  field-by-field). */
export default function LoansGateStep({ ctx, onDirtyChange, submitRef }: StepComponentProps) {
  const { answer, setAnswer, storedStatus, entityCount } = useGateAnswer(
    'loans_gate', ctx, submitRef, onDirtyChange,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const cfg = GATE_CONFIG.loans_gate;
  return (
    <>
      <GateQuestion
        idPrefix="gate-loans"
        question={cfg.question}
        consequence={cfg.consequence}
        intro={
          <p data-testid="flow-loans-intro" className="text-sm text-muted-foreground">
            Listing what you owe is just for an accurate picture — there is no judgment here.
          </p>
        }
        entityCount={entityCount}
        nounSingular={cfg.nounSingular}
        nounPlural={cfg.nounPlural}
        storedStatus={storedStatus}
        answer={answer}
        onAnswer={setAnswer}
      >
        <EntityCard
          title="Loans"
          description="Mortgages, auto, student, personal, credit cards, etc."
          count={ctx.loans.length}
          onAddManual={() => setDialogOpen(true)}
          importEnabled
          importTrigger={<ImportCsvButton entity="loan" />}
          items={ctx.loans.map((l, i) => ({ key: l.id ?? i, label: l.name }))}
          manageHref="/loans"
          manageLabel="Manage on Loans page"
        />
      </GateQuestion>
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a loan</DialogTitle>
            <DialogDescription className="sr-only">
              Add a loan with its balance, rate, and payment schedule.
            </DialogDescription>
          </DialogHeader>
          <LoanForm onSaved={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
