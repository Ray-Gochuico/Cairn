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

/** Per-preference tier quotas for the day's set (Wave 8 D1). Mix is v2's 2+2. */
const TIER_TARGETS: Record<LearningDifficulty, { Beginner: number; Advanced: number }> = {
  Beginner: { Beginner: 4, Advanced: 0 },
  Advanced: { Beginner: 0, Advanced: 4 },
  Mixed: { Beginner: 2, Advanced: 2 },
};

interface SelectSetArgs {
  /** Already reviewed-only (the load-filter runs upstream in load-bank.ts). */
  bank: TriviaQuestion[];
  /** PRIOR-DAY answered keys to EXCLUDE (getAnsweredKeysByDay().priorDays), `id@vN`. */
  answeredIds: string[];
  /** TODAY's answered keys — kept in the set (shown graded), and ANCHORED across a mid-day preference toggle. */
  answeredTodayIds?: string[];
  todayISO: string;
  /**
   * The user's persistent difficulty preference (learning_state, revived
   * Wave 8). 'Mixed' (the default) is byte-identical to the v2 2+2 walk. A
   * strict preference does NOT borrow from the other tier when its pool runs
   * dry — the page's exhausted state says so and points at the toggle,
   * rather than quietly serving what the user opted out of.
   */
  preference?: LearningDifficulty;
}

/**
 * Today's set (normally 4), preference-aware, pure + clock-injected.
 *
 * Two-phase construction (Wave 8 D1):
 *  1. BASE WALK — the v2 algorithm parameterized by TIER_TARGETS: per-tier
 *     deterministic day-hash order, topic-distinct greedy pass, same-topic
 *     relaxation. Blind to which questions are answered today.
 *  2. ANCHOR RECONCILIATION — today-answered questions the base walk didn't
 *     pick (possible ONLY after a mid-day preference toggle or a bank change)
 *     are merged in, evicting unanswered base picks from the end so the set
 *     stays at 4 (it can exceed 4 only when the user has ANSWERED more than 4
 *     today via toggling — every extra card is one they answered, never a new
 *     unanswered slot).
 *
 * Invariants (locked by tests): deterministic per (day, preference,
 * answered-partition); answering a question NEVER re-rolls the others —
 * under an unchanged preference the base walk already contains every
 * today-answered question, so phase 2 is a no-op and the result is
 * byte-identical to the pre-answer set. Degrades gracefully to <4 on a thin
 * pool (never throws, never pads with dupes) — the 1→4 rollout continuum.
 */
export function selectDailySet(args: SelectSetArgs): TriviaQuestion[] {
  const { bank, answeredIds, answeredTodayIds = [], todayISO, preference = 'Mixed' } = args;

  const todayKeys = new Set(answeredTodayIds);
  // Eligible pool = reviewed bank minus PRIOR-DAY answers. Today's answers
  // stay eligible — that's what holds the set stable mid-day.
  const priorAnswered = new Set(answeredIds.filter((k) => !todayKeys.has(k)));
  const eligible = bank.filter((qq) => !priorAnswered.has(answeredKey(qq.id, qq.version)));

  // Per-tier deterministic order: stable per day, varies by day.
  const order = (q: TriviaQuestion) => hash(`${todayISO}:${q.id}`);
  const byOrder = (a: TriviaQuestion, b: TriviaQuestion) => order(a) - order(b);
  const beginner = eligible.filter((q) => q.difficulty === 'Beginner').sort(byOrder);
  const advanced = eligible.filter((q) => q.difficulty === 'Advanced').sort(byOrder);

  // ── Phase 1: base walk ──────────────────────────────────────────────────
  const targets = TIER_TARGETS[preference];
  const chosen: TriviaQuestion[] = [];
  const usedTopics = new Set<string>();

  // Greedy pick of `n` from `tier`, preferring a NOT-yet-used topic across
  // the whole set; relax to same-topic (rather than return <n unnecessarily)
  // only once distinct-topic options are exhausted.
  const pickFrom = (tier: TriviaQuestion[], n: number) => {
    let picked = 0;
    for (const q of tier) {
      if (picked >= n) break;
      if (chosen.includes(q)) continue;
      if (usedTopics.has(q.topic)) continue;
      chosen.push(q);
      usedTopics.add(q.topic);
      picked++;
    }
    for (const q of tier) {
      if (picked >= n) break;
      if (chosen.includes(q)) continue;
      chosen.push(q);
      usedTopics.add(q.topic);
      picked++;
    }
  };

  pickFrom(beginner, targets.Beginner);
  pickFrom(advanced, targets.Advanced);

  // ── Phase 2: anchor reconciliation (no-op unless the preference changed
  // mid-day after answering, or the bank changed under the user) ────────────
  const isAnsweredToday = (q: TriviaQuestion) => todayKeys.has(answeredKey(q.id, q.version));
  const chosenIds = new Set(chosen.map((q) => q.id));
  const extras = eligible.filter((q) => isAnsweredToday(q) && !chosenIds.has(q.id)).sort(byOrder);
  if (extras.length === 0) return chosen;

  const answeredInPool = chosen.filter(isAnsweredToday).length + extras.length;
  const cap = Math.max(4, answeredInPool);
  const kept = [...chosen];
  for (let i = kept.length - 1; i >= 0 && kept.length + extras.length > cap; i--) {
    if (!isAnsweredToday(kept[i])) kept.splice(i, 1);
  }
  return [...kept, ...extras].sort((a, b) =>
    a.difficulty === b.difficulty ? order(a) - order(b) : a.difficulty === 'Beginner' ? -1 : 1,
  );
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
