import { useEffect, useState, type ComponentType } from 'react';
import GateQuestion from '../GateQuestion';
import { GATE_CONFIG } from '../step-registry';
import { GATE_ENTITY_COUNT, type GateStepId } from '@/domain/setup-flow/engine';
import { stepKey } from '@/lib/setup-progress';
import type { StepComponentProps } from '../step-props';

/**
 * Card-less gate step (Task 6): REAL functionality — question, honesty notes,
 * restorable yes/no, D-WF11 statuses via the shell — with the inline entity
 * cards swapped in by Tasks 8–9 registry upgrades. GATE_CONFIG access is
 * render-time only, so the registry↔factory import cycle never dereferences
 * a half-initialized binding.
 */
export function makeSimpleGateStep(id: GateStepId): ComponentType<StepComponentProps> {
  function SimpleGateStep({ ctx, onDirtyChange, submitRef }: StepComponentProps) {
    const key = stepKey(id);
    const storedStatus = ctx.progress.statuses[key] ?? 'pending';
    const entityCount = GATE_ENTITY_COUNT[id](ctx);
    const [answer, setAnswer] = useState<'yes' | 'no' | null>(() => {
      if (storedStatus === 'skipped') return 'no';
      if (storedStatus === 'completed' || storedStatus === 'in_progress') return 'yes';
      return null;
    });

    useEffect(() => {
      // Gates hold restorable answer state, not unsaved entries — never dirty.
      onDirtyChange(false);
    }, [onDirtyChange]);

    useEffect(() => {
      submitRef.current = async () => ({
        ok: answer != null || entityCount > 0,
        // Data forces yes (gate honesty) — a stale local "no" never records a
        // skip over existing rows.
        gateAnswer: entityCount > 0 ? 'yes' : answer ?? 'yes',
      });
    });

    const cfg = GATE_CONFIG[id];
    return (
      <GateQuestion
        idPrefix={`gate-${id}`}
        question={cfg.question}
        consequence={cfg.consequence}
        entityCount={entityCount}
        nounSingular={cfg.nounSingular}
        nounPlural={cfg.nounPlural}
        storedStatus={storedStatus}
        answer={answer}
        onAnswer={setAnswer}
        changedYourMindText={cfg.changedYourMindText}
      />
    );
  }
  SimpleGateStep.displayName = `SimpleGateStep(${id})`;
  return SimpleGateStep;
}
