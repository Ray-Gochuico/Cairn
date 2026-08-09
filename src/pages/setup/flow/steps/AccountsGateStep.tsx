import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import EntityCard from '@/pages/setup/EntityCard';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import AccountFormImpl from '@/components/forms/AccountForm';
import { DEFAULT_ACCOUNT } from '@/lib/entity-scaffolds';
import GateQuestion from '../GateQuestion';
import { GATE_CONFIG } from '../step-registry';
import { GATE_ENTITY_COUNT } from '@/domain/setup-flow/engine';
import { createAccountWithBalance } from '@/domain/setup-flow/steps/accounts-gate';
import { stepKey } from '@/lib/setup-progress';
import type { FlowCtx } from '@/domain/setup-flow/types';
import type { StepComponentProps } from '../step-props';

/** CW-36 balance field above the canonical account form — the flow's
 *  three-write create (spec rule 4). */
function FlowAccountCreate({ ctx, onSaved }: { ctx: FlowCtx; onSaved: () => void }) {
  const [balance, setBalance] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="flow-account-balance">Current balance — optional</Label>
        <MoneyInput
          id="flow-account-balance"
          value={balance}
          onValueChange={setBalance}
          aria-describedby="flow-account-balance-hint"
        />
        <p id="flow-account-balance-hint" className="text-xs text-muted-foreground mt-1">
          Saved as today&#39;s balance snapshot for this account.
        </p>
      </div>
      <AccountFormImpl
        initial={DEFAULT_ACCOUNT}
        persons={ctx.persons
          .filter((p) => p.id != null)
          .map((p) => ({ id: p.id!, name: p.name }))}
        dependents={ctx.dependents
          .filter((d) => d.id != null)
          .map((d) => ({ id: d.id!, name: d.name }))}
        submitLabel="Add Account"
        onSubmit={async (values) => {
          await createAccountWithBalance(values, balance, ctx.todayIso);
          onSaved();
        }}
        onCancel={onSaved}
      />
    </div>
  );
}

/** The accounts gate — the ONE gate with flow-specific persistence. */
export default function AccountsGateStep({ ctx, onDirtyChange, submitRef }: StepComponentProps) {
  const key = stepKey('accounts_gate');
  const storedStatus = ctx.progress.statuses[key] ?? 'pending';
  const entityCount = GATE_ENTITY_COUNT.accounts_gate(ctx);
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(() => {
    if (storedStatus === 'skipped') return 'no';
    if (storedStatus === 'completed' || storedStatus === 'in_progress') return 'yes';
    return null;
  });
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    // Entries save through the dialog's own form — the step is never dirty.
    onDirtyChange(false);
  }, [onDirtyChange]);

  useEffect(() => {
    submitRef.current = async () => ({
      ok: answer != null || entityCount > 0,
      gateAnswer: entityCount > 0 ? 'yes' : answer ?? 'yes',
    });
  });

  const cfg = GATE_CONFIG.accounts_gate;
  return (
    <>
      <GateQuestion
        idPrefix="gate-accounts"
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
          title="Accounts"
          description="Checking, savings, brokerage, 401k, IRA, HSA, 529, etc."
          count={ctx.accounts.length}
          onAddManual={() => setDialogOpen(true)}
          importEnabled
          importTrigger={<ImportCsvButton entity="account" />}
          items={ctx.accounts.map((a, i) => ({ key: a.id ?? i, label: a.name }))}
          manageHref="/investments?manage=accounts"
          manageLabel="Manage on Investments page"
        />
      </GateQuestion>
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add an account</DialogTitle>
            <DialogDescription className="sr-only">
              Add a cash, brokerage, or retirement account to track.
            </DialogDescription>
          </DialogHeader>
          <FlowAccountCreate ctx={ctx} onSaved={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
