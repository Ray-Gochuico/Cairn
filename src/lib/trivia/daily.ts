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

interface SelectSetArgs {
  /** Already reviewed-only (the load-filter runs upstream in load-bank.ts). */
  bank: TriviaQuestion[];
  /**
   * PRIOR-DAY answered keys to EXCLUDE (from getAnsweredKeysByDay().priorDays).
   * Version-aware (`id@vN`).
   */
  answeredIds: string[];
  /**
   * TODAY's answered keys to KEEP in the set (shown answered/greyed), from
   * getAnsweredKeysByDay().today. Including these keeps the day's 4 STABLE under
   * mid-day answering — the derive anchor's key invariant (§3.0). The set is
   * computed from a day-seeded deterministic walk that does NOT depend on which
   * of the 4 are answered, so answering one never re-rolls the others.
   */
  answeredTodayIds?: string[];
  todayISO: string;
  // No per-question difficulty PREFERENCE — the 4-set is fixed at 2 Beginner +
  // 2 Advanced by design (D5), independent of the retired LearningDifficulty.
}

/**
 * Today's set of up to 4 (2 Beginner + 2 Advanced), topic-aware, pure +
 * clock-injected. Deterministic per day (varies by day), drawn from the unseen
 * reviewed pool. Prior-day-answered questions are excluded; today-answered ones
 * stay in the set (shown graded) so answering during the day doesn't shrink or
 * re-roll the 4. Degrades gracefully to <4 on a thin pool (returns what exists,
 * never throws, never pads with dupes) — which IS the 1→4 rollout continuum
 * (L1.5).
 */
export function selectDailySet(args: SelectSetArgs): TriviaQuestion[] {
  const { bank, answeredIds, answeredTodayIds = [], todayISO } = args;

  // Eligible pool = reviewed bank minus PRIOR-DAY answers. Today's answers stay
  // eligible (kept in the set) — that's what holds the set stable mid-day.
  const priorAnswered = new Set(answeredIds.filter((k) => !answeredTodayIds.includes(k)));
  const eligible = bank.filter((qq) => !priorAnswered.has(answeredKey(qq.id, qq.version)));

  // Per-tier deterministic order: stable per day, varies by day.
  const order = (q: TriviaQuestion) => hash(`${todayISO}:${q.id}`);
  const byOrder = (a: TriviaQuestion, b: TriviaQuestion) => order(a) - order(b);
  const beginner = eligible.filter((q) => q.difficulty === 'Beginner').sort(byOrder);
  const advanced = eligible.filter((q) => q.difficulty === 'Advanced').sort(byOrder);

  const chosen: TriviaQuestion[] = [];
  const usedTopics = new Set<string>();

  // Greedy pick of `n` from `tier`, preferring a NOT-yet-used topic across the
  // whole 4; relax to a same-topic pick (rather than return <4 unnecessarily)
  // only once distinct-topic options are exhausted.
  const pickFrom = (tier: TriviaQuestion[], n: number) => {
    let picked = 0;
    // First pass: distinct topics.
    for (const q of tier) {
      if (picked >= n) break;
      if (chosen.includes(q)) continue;
      if (usedTopics.has(q.topic)) continue;
      chosen.push(q);
      usedTopics.add(q.topic);
      picked++;
    }
    // Relaxation pass: allow same-topic to fill the count if the pool can.
    for (const q of tier) {
      if (picked >= n) break;
      if (chosen.includes(q)) continue;
      chosen.push(q);
      usedTopics.add(q.topic);
      picked++;
    }
  };

  pickFrom(beginner, 2);
  pickFrom(advanced, 2);

  return chosen;
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
