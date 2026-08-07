import { create } from 'zustand';
import { InterviewAnswersRepo } from '@/domain/interview-answers-repo';
import { createDedupedLoad } from '@/stores/create-entity-store';
import { getDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import { answerKey, type InterviewAnswer } from '@/types/interview';

/**
 * Durable guided-interview answers (design §1.2), keyed
 * `${threadId}/${questionId}/${subjectKey}` for O(1) reads inside
 * evaluateThread. Mutations write through the repo then reload the map
 * (the roadmap-overrides-store idiom). Hydration is owned by Roadmap.tsx
 * behind its latched useLoadGate (D-GI14) — components never call load().
 */
interface InterviewAnswersState {
  /** Keyed `${threadId}/${questionId}/${subjectKey}`. */
  answersByKey: Map<string, InterviewAnswer>;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  saveAnswer: (input: {
    threadId: string;
    questionId: string;
    subjectKey: string;
    value: unknown;
    questionVersion: number;
    basis: Record<string, unknown> | null;
  }) => Promise<void>;
  clearAnswer: (threadId: string, questionId: string, subjectKey: string) => Promise<void>;
}

function currentHouseholdId(): number {
  return useHouseholdStore.getState().household?.id ?? 1;
}

export const useInterviewAnswersStore = create<InterviewAnswersState>((set, get) => ({
  answersByKey: new Map(),
  isLoading: false,
  error: null,

  load: createDedupedLoad<InterviewAnswersState, 'answersByKey'>(set, 'answersByKey', async () => {
    const repo = new InterviewAnswersRepo(getDatabase());
    const rows = await repo.list();
    const map = new Map<string, InterviewAnswer>();
    for (const row of rows) map.set(answerKey(row.threadId, row.questionId, row.subjectKey), row);
    return map;
  }),

  saveAnswer: async (input) => {
    const repo = new InterviewAnswersRepo(getDatabase());
    await repo.upsert({
      householdId: currentHouseholdId(),
      threadId: input.threadId,
      questionId: input.questionId,
      subjectKey: input.subjectKey,
      valueJson: JSON.stringify(input.value),
      questionVersion: input.questionVersion,
      // The one sanctioned wall-clock read (matches roadmap-overrides set_at).
      answeredAt: new Date().toISOString(),
      basisJson: input.basis == null ? null : JSON.stringify(input.basis),
    });
    await get().load();
  },

  clearAnswer: async (threadId, questionId, subjectKey) => {
    const repo = new InterviewAnswersRepo(getDatabase());
    await repo.delete(currentHouseholdId(), threadId, questionId, subjectKey);
    await get().load();
  },
}));
