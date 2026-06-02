import { create } from 'zustand';
import { LearningStateRepo } from '@/domain/learning-state';
import { getDatabase } from '@/db/db';
import { localTodayISO } from '@/lib/trivia/daily';
import type { LearningState, LearningAnswer } from '@/types/schema';

interface AnsweredKeysByDay {
  /** Prior-day answered keys — EXCLUDED from today's 4-set (derive anchor §3.0). */
  priorDays: string[];
  /** Today's answered keys — KEPT in the set, shown answered/greyed. */
  today: string[];
}

interface LearningStoreState {
  learningState: LearningState | null;
  /**
   * Version-aware answered keys (`answeredKey(id, version)` → `id@vN`) mirrored
   * from the repo. The daily selector compares the current bank's (id, version)
   * against this set, so a corrected/bumped question re-prompts (TR-3 / §4.1).
   */
  answeredQuestionIds: string[];
  /**
   * Date-partitioned answered keys for the derive anchor (L1.0 / §3.0), computed
   * at load/update time against `localTodayISO(new Date())`. `selectDailySet`
   * excludes `priorDays` and keeps `today` (just-answered, shown greyed) so the
   * day's 4-set stays stable under mid-day answering. (Same load-time "now"
   * staleness tradeoff as the existing `answeredToday` derivation.)
   */
  answeredKeysByDay: AnsweredKeysByDay;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  update: (patch: Partial<Omit<LearningState, 'id'>>) => Promise<void>;
  recordAnswer: (a: Omit<LearningAnswer, 'id'>) => Promise<void>;
}

export const useLearningStore = create<LearningStoreState>((set, get) => ({
  learningState: null,
  answeredQuestionIds: [],
  answeredKeysByDay: { priorDays: [], today: [] },
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new LearningStateRepo(getDatabase());
      const [learningState, answeredQuestionIds, answeredKeysByDay] = await Promise.all([
        repo.get(),
        repo.listAnsweredQuestionIds(),
        repo.getAnsweredKeysByDay(localTodayISO(new Date())),
      ]);
      set({ learningState, answeredQuestionIds, answeredKeysByDay, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  update: async (patch) => {
    set({ isLoading: true, error: null });
    try {
      const repo = new LearningStateRepo(getDatabase());
      await repo.update(patch);
      const [learningState, answeredQuestionIds, answeredKeysByDay] = await Promise.all([
        repo.get(),
        repo.listAnsweredQuestionIds(),
        repo.getAnsweredKeysByDay(localTodayISO(new Date())),
      ]);
      set({ learningState, answeredQuestionIds, answeredKeysByDay, isLoading: false });
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
