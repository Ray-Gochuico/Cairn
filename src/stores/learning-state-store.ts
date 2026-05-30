import { create } from 'zustand';
import { LearningStateRepo } from '@/domain/learning-state';
import { getDatabase } from '@/db/db';
import type { LearningState, LearningAnswer } from '@/types/schema';

interface LearningStoreState {
  learningState: LearningState | null;
  /**
   * Version-aware answered keys (`answeredKey(id, version)` → `id@vN`) mirrored
   * from the repo. The daily selector compares the current bank's (id, version)
   * against this set, so a corrected/bumped question re-prompts (TR-3 / §4.1).
   */
  answeredQuestionIds: string[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  update: (patch: Partial<Omit<LearningState, 'id'>>) => Promise<void>;
  recordAnswer: (a: Omit<LearningAnswer, 'id'>) => Promise<void>;
}

export const useLearningStore = create<LearningStoreState>((set, get) => ({
  learningState: null,
  answeredQuestionIds: [],
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new LearningStateRepo(getDatabase());
      const [learningState, answeredQuestionIds] = await Promise.all([
        repo.get(),
        repo.listAnsweredQuestionIds(),
      ]);
      set({ learningState, answeredQuestionIds, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  update: async (patch) => {
    set({ isLoading: true, error: null });
    try {
      const repo = new LearningStateRepo(getDatabase());
      await repo.update(patch);
      const [learningState, answeredQuestionIds] = await Promise.all([
        repo.get(),
        repo.listAnsweredQuestionIds(),
      ]);
      set({ learningState, answeredQuestionIds, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to update' });
      throw e;
    }
  },

  recordAnswer: async (a) => {
    const repo = new LearningStateRepo(getDatabase());
    await repo.recordAnswer(a);
    await get().load();
  },
}));
