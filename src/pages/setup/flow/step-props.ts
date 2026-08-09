import type { MutableRefObject } from 'react';
import type { Role } from '@/lib/setup-progress';
import type { FlowCtx, StepSaveResult } from '@/domain/setup-flow/types';

export interface StepComponentProps {
  ctx: FlowCtx;
  role?: Role;
  /** True once the step was previously asked (status ≠ pending) — drives
   *  prefill-vs-unanswered (Persistence rule 6). */
  asked: boolean;
  onDirtyChange: (dirty: boolean) => void;
  /** The shell calls this on Next. Component validates + saves. */
  submitRef: MutableRefObject<(() => Promise<StepSaveResult>) | null>;
}
