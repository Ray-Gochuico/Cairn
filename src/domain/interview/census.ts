import type { InterviewContext } from '@/types/interview';
import { evaluateThread, subjectsOf } from './evaluate';
import { INTERVIEW_THREADS } from './registry';

/**
 * R4 (D-R4-9): ≥ 1 strip thread × subject in the `ask` state — the G9 census
 * What-If ORs into `roadmapHasUnanswered`. Pure over ctx (the same walk
 * InterviewThreads renders); next_dollar is the bar, never an ask; short-
 * circuits on the first ask. Lives BESIDE evaluate.ts (not inside it) so the
 * registry → threads → evaluate import chain has no cycle.
 */
export function anyInterviewAsk(ctx: InterviewContext): boolean {
  for (const thread of INTERVIEW_THREADS) {
    if (thread.id === 'next_dollar') continue;
    for (const subject of subjectsOf(thread, ctx)) {
      if (evaluateThread(thread, ctx, subject).state === 'ask') return true;
    }
  }
  return false;
}
