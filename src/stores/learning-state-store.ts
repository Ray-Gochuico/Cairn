import { create } from 'zustand';
import { LearningStateRepo } from '@/domain/learning-state';
import { createDedupedLoadPartial } from '@/stores/create-entity-store';
import { getDatabase } from '@/db/db';
import { localTodayISO } from '@/lib/trivia/daily';
import type { LearningState, LearningAnswer } from '@/types/schema';

interface AnsweredKeysByDay {
  /** Prior-day answered keys — EXCLUDED from today's set (derive anchor §3.0). */
  priorDays: string[];
  /** Today's answered keys — KEPT in the set, shown graded; anchored across a preference toggle (Wave 8 D1). */
  today: string[];
  /** Today's persisted chosen_index per key — rehydrates the stepped-back graded reveal (Wave 8 D2). */
  todayDetails: Array<{ key: string; chosenIndex: number }>;
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
   * excludes `priorDays` and keeps `today` (just-answered, shown graded) so the
   * day's set stays stable under mid-day answering. (Same load-time "now"
   * staleness tradeoff as the existing `answeredToday` derivation; the Learn
   * page's useLocalToday hook re-loads on a day flip.)
   */
  answeredKeysByDay: AnsweredKeysByDay;
  /** All-time participation + accuracy for the Learn header's progress line (null until first load). */
  answeredStats: { answered: number; correct: number } | null;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  update: (patch: Partial<Omit<LearningState, 'id'>>) => Promise<void>;
  /**
   * Append the audit row and (optionally) apply the streak patch, then ONE
   * combined refresh (Wave 8 perf: previously answer → full load, then the
   * page issued a second update → second full refresh ≈ 8+ round-trips).
   */
  recordAnswer: (
    a: Omit<LearningAnswer, 'id'>,
    statePatch?: Partial<Omit<LearningState, 'id'>>,
  ) => Promise<void>;
}

async function fetchAll(): Promise<
  Pick<LearningStoreState, 'learningState' | 'answeredQuestionIds' | 'answeredKeysByDay' | 'answeredStats'>
> {
  const repo = new LearningStateRepo(getDatabase());
  const [learningState, answeredQuestionIds, answeredKeysByDay, answeredStats] = await Promise.all([
    repo.get(),
    repo.listAnsweredQuestionIds(),
    repo.getAnsweredKeysByDay(localTodayISO(new Date())),
    repo.answeredStats(),
  ]);
  return { learningState, answeredQuestionIds, answeredKeysByDay, answeredStats };
}

export const useLearningStore = create<LearningStoreState>((set) => ({
  learningState: null,
  answeredQuestionIds: [],
  answeredKeysByDay: { priorDays: [], today: [], todayDetails: [] },
  answeredStats: null,
  isLoading: false,
  error: null,

  // Shared de-duped multi-key load (createDedupedLoadPartial): one fetch
  // lands four public fields, so the single-key factory doesn't fit and
  // collapsing them into one object would break the fields' consumers.
  load: createDedupedLoadPartial<LearningStoreState>(set, fetchAll),

  update: async (patch) => {
    set({ isLoading: true, error: null });
    try {
      const repo = new LearningStateRepo(getDatabase());
      await repo.update(patch);
      set({ ...(await fetchAll()), isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to update' });
      throw e;
    }
  },

  recordAnswer: async (a, statePatch) => {
    const repo = new LearningStateRepo(getDatabase());
    await repo.recordAnswer(a);
    if (statePatch) await repo.update(statePatch);
    set(await fetchAll());
  },
}));
