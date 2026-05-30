import type { TriviaQuestion } from '@/lib/trivia/bank-schema';
import type { LearningDifficulty } from '@/types/enums';
import { answeredKey } from '@/lib/trivia/answered-key';

/**
 * Pure daily-selection + streak logic. No Date.now() inside the pure
 * functions — callers pass today's LOCAL ISO date. See spec §8.
 */

/** Local calendar day as YYYY-MM-DD (NOT toISOString, which is UTC). */
export function localTodayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The ISO date one day before `iso` (handles month/year boundaries). */
export function yesterday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return localTodayISO(dt);
}

// djb2 string hash — small, deterministic, platform-stable.
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

interface SelectArgs {
  bank: TriviaQuestion[];
  /**
   * Version-aware answered keys (`answeredKey(id, version)` → `id@vN`), NOT bare
   * ids. A question counts as seen only when THIS version was answered, so a
   * content correction that bumps the version re-prompts (TR-3 / §4.1). The
   * repo + store produce these keys.
   */
  answeredIds: string[];
  difficulty: LearningDifficulty;
  todayISO: string;
  state: { lastShownIsoDate: string | null; lastShownQuestionId: string | null };
}

/**
 * Today's question, or null if the eligible pool is exhausted. Stable within
 * a day: when state.lastShownIsoDate === todayISO and that question still
 * exists, returns it verbatim (no intra-day re-roll — anti-gaming).
 */
export function selectDailyQuestion(args: SelectArgs): TriviaQuestion | null {
  const { bank, answeredIds, difficulty, todayISO, state } = args;

  // Rule 1: pin within the day.
  if (state.lastShownIsoDate === todayISO && state.lastShownQuestionId) {
    const pinned = bank.find((q) => q.id === state.lastShownQuestionId);
    if (pinned) return pinned;
  }

  const answered = new Set(answeredIds);
  // Version-aware: a question is "seen" only if THIS (id, version) was answered.
  // A bumped version (v1.2 correction) has a key not in the set → it re-prompts.
  const unseen = bank.filter((q) => !answered.has(answeredKey(q.id, q.version)));
  const beginner = unseen.filter((q) => q.difficulty === 'Beginner');
  const advanced = unseen.filter((q) => q.difficulty === 'Advanced');

  let pool: TriviaQuestion[];
  if (difficulty === 'Beginner') {
    pool = beginner;
  } else if (difficulty === 'Advanced') {
    pool = advanced;
  } else {
    // Mixed: ~70/30 toward beginner. Deterministic per day: use the day hash
    // to decide which sub-pool to draw from (falling back to the other if the
    // chosen one is empty).
    const wantBeginner = hash(todayISO) % 10 < 7;
    const primary = wantBeginner ? beginner : advanced;
    const secondary = wantBeginner ? advanced : beginner;
    pool = primary.length > 0 ? primary : secondary;
  }

  if (pool.length === 0) return null;

  // Stable, varied per day: index by the day hash.
  const idx = hash(todayISO) % pool.length;
  return pool[idx];
}

interface StreakArgs {
  current: number;
  lastAnsweredISO: string | null;
  todayISO: string;
}

/**
 * Next streak count after answering today. Counts PARTICIPATION (not
 * correctness): a wrong answer still extends the streak — wrong is a teaching
 * moment, never a streak-breaker (calm-by-design). Resets quietly to 1 after
 * any gap. See spec §8.4.
 */
export function nextStreak({ current, lastAnsweredISO, todayISO }: StreakArgs): number {
  if (lastAnsweredISO === todayISO) return current; // idempotent same-day
  if (lastAnsweredISO === yesterday(todayISO)) return current + 1;
  return 1;
}
