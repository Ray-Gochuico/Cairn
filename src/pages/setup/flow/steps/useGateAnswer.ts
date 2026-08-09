import { useEffect, useState, type MutableRefObject } from 'react';
import { GATE_ENTITY_COUNT, type GateStepId } from '@/domain/setup-flow/engine';
import { stepKey, type StepStatus } from '@/lib/setup-progress';
import type { FlowCtx, StepSaveResult } from '@/domain/setup-flow/types';

/**
 * Shared gate answer state (factored out of makeSimpleGateStep, Task 9):
 * restorable yes/no seeded from the RECORDED LITERAL answer (review M2 —
 * a status derived by a form-view Section action never pre-selects the
 * control), never-dirty semantics (entries save through the cards' own
 * dialogs), and the D-WF11 submit — data forces yes so a stale local "no"
 * never records a skip over rows. A pristine submit (no answer, no data)
 * surfaces the required error instead of silently no-oping (review m2).
 */
export function useGateAnswer(
  id: GateStepId,
  ctx: FlowCtx,
  submitRef: MutableRefObject<(() => Promise<StepSaveResult>) | null>,
  onDirtyChange: (dirty: boolean) => void,
): {
  answer: 'yes' | 'no' | null;
  setAnswer: (a: 'yes' | 'no') => void;
  storedStatus: StepStatus;
  literalAnswer: 'yes' | 'no' | null;
  entityCount: number;
  requiredError: boolean;
} {
  const key = stepKey(id);
  const storedStatus = ctx.progress.statuses[key] ?? 'pending';
  const literalAnswer = ctx.progress.gateAnswers[key] ?? null;
  const entityCount = GATE_ENTITY_COUNT[id](ctx);
  const [answer, setAnswerState] = useState<'yes' | 'no' | null>(literalAnswer);
  const [requiredError, setRequiredError] = useState(false);

  const setAnswer = (a: 'yes' | 'no') => {
    setRequiredError(false);
    setAnswerState(a);
  };

  useEffect(() => {
    onDirtyChange(false);
  }, [onDirtyChange]);

  useEffect(() => {
    submitRef.current = async () => {
      if (answer == null && entityCount === 0) {
        setRequiredError(true);
        return { ok: false };
      }
      return {
        ok: true,
        // Data forces yes (gate honesty) — a stale local "no" never records a
        // skip over existing rows.
        gateAnswer: entityCount > 0 ? 'yes' : answer ?? 'yes',
      };
    };
  });

  return { answer, setAnswer, storedStatus, literalAnswer, entityCount, requiredError };
}
