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
import EquityGrantForm, { DEFAULT_EQUITY_GRANT } from '@/components/forms/EquityGrantForm';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import GateQuestion from '../GateQuestion';
import { GATE_CONFIG } from '../step-registry';
import { useGateAnswer } from './useGateAnswer';
import type { StepComponentProps } from '../step-props';

/** equity_gate — the Section 2 equity-grants card inline. */
export default function EquityGateStep({ ctx, onDirtyChange, submitRef }: StepComponentProps) {
  const { answer, setAnswer, storedStatus, literalAnswer, entityCount, requiredError } = useGateAnswer(
    'equity_gate', ctx, submitRef, onDirtyChange,
  );
  const createEquityGrant = useEquityGrantsStore((s) => s.create);
  const [dialogOpen, setDialogOpen] = useState(false);
  const cfg = GATE_CONFIG.equity_gate;
  return (
    <>
      <GateQuestion
        idPrefix="gate-equity"
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
          title="Equity grants"
          description="RSUs, stock options with vesting schedules."
          count={ctx.equityGrants.length}
          onAddManual={() => setDialogOpen(true)}
          importEnabled
          importTrigger={<ImportCsvButton entity="equity_grant" />}
          items={ctx.equityGrants.map((g, i) => ({ key: g.id ?? i, label: g.name }))}
          manageHref="/equity-grants"
          manageLabel="Manage on Equity grants page"
        />
      </GateQuestion>
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add an equity grant</DialogTitle>
            <DialogDescription className="sr-only">
              Add an equity grant with its vesting schedule.
            </DialogDescription>
          </DialogHeader>
          <EquityGrantForm
            initial={DEFAULT_EQUITY_GRANT}
            persons={ctx.persons
              .filter((p) => p.id != null)
              .map((p) => ({ id: p.id!, name: p.name }))}
            onSubmit={async (values) => {
              await createEquityGrant(values);
              setDialogOpen(false);
            }}
            onCancel={() => setDialogOpen(false)}
            submitLabel="Add Grant"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
