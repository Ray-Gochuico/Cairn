import { useEffect, useState, type MutableRefObject } from 'react';
import { GATE_ENTITY_COUNT, type GateStepId } from '@/domain/setup-flow/engine';
import { stepKey, type StepStatus } from '@/lib/setup-progress';
import type { FlowCtx, StepSaveResult } from '@/domain/setup-flow/types';

/**
 * Shared gate answer state (factored out of makeSimpleGateStep, Task 9):
 * restorable yes/no seeded from the stored status, never-dirty semantics
 * (entries save through the cards' own dialogs), and the D-WF11 submit —
 * data forces yes so a stale local "no" never records a skip over rows.
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
  entityCount: number;
} {
  const key = stepKey(id);
  const storedStatus = ctx.progress.statuses[key] ?? 'pending';
  const entityCount = GATE_ENTITY_COUNT[id](ctx);
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(() => {
    if (storedStatus === 'skipped') return 'no';
    if (storedStatus === 'completed' || storedStatus === 'in_progress') return 'yes';
    return null;
  });

  useEffect(() => {
    onDirtyChange(false);
  }, [onDirtyChange]);

  useEffect(() => {
    submitRef.current = async () => ({
      ok: answer != null || entityCount > 0,
      gateAnswer: entityCount > 0 ? 'yes' : answer ?? 'yes',
    });
  });

  return { answer, setAnswer, storedStatus, entityCount };
}
