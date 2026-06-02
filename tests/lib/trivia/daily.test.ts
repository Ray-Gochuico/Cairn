import { describe, it, expect } from 'vitest';
import {
  localTodayISO,
  yesterday,
  selectDailyQuestion,
  selectDailySet,
  nextStreak,
} from '@/lib/trivia/daily';
import { answeredKey } from '@/lib/trivia/answered-key';
import { QuestionFormat, Topic } from '@/types/enums';
import type { TriviaQuestion } from '@/lib/trivia/bank-schema';

const q = (id: string, difficulty: 'Beginner' | 'Advanced'): TriviaQuestion => ({
  id,
  version: 1,
  difficulty,
  format: QuestionFormat.DEFINITION,
  topic: Topic.FOUNDATIONS,
  prompt: `prompt ${id}`,
  choices: ['a', 'b', 'c', 'd'],
  answerIndex: 0,
  explanation: 'x',
  source: 'src',
  reviewed: true,
});

// Topic-aware factory for selectDailySet tests.
const qt = (id: string, difficulty: 'Beginner' | 'Advanced', topic: Topic): TriviaQuestion => ({
  ...q(id, difficulty),
  topic,
});

const bank: TriviaQuestion[] = [
  q('beg-1', 'Beginner'),
  q('beg-2', 'Beginner'),
  q('beg-3', 'Beginner'),
  q('adv-1', 'Advanced'),
  q('adv-2', 'Advanced'),
];

describe('localTodayISO', () => {
  it('formats a local date as YYYY-MM-DD (not UTC)', () => {
    const d = new Date(2026, 4, 28, 23, 30); // May 28 2026, local 23:30
    expect(localTodayISO(d)).toBe('2026-05-28');
  });
});

describe('yesterday', () => {
  it('subtracts a day', () => {
    expect(yesterday('2026-05-28')).toBe('2026-05-27');
  });
  it('crosses a month boundary', () => {
    expect(yesterday('2026-06-01')).toBe('2026-05-31');
  });
  it('crosses a year boundary', () => {
    expect(yesterday('2026-01-01')).toBe('2025-12-31');
  });
});

describe('selectDailyQuestion', () => {
  it('pins to lastShownQuestionId when lastShownIsoDate is today', () => {
    const out = selectDailyQuestion({
      bank,
      answeredIds: [],
      difficulty: 'Beginner',
      todayISO: '2026-05-28',
      state: { lastShownIsoDate: '2026-05-28', lastShownQuestionId: 'beg-2' },
    });
    expect(out?.id).toBe('beg-2');
  });

  it('filters by Beginner difficulty', () => {
    const out = selectDailyQuestion({
      bank,
      answeredIds: [],
      difficulty: 'Beginner',
      todayISO: '2026-05-28',
      state: { lastShownIsoDate: null, lastShownQuestionId: null },
    });
    expect(out?.difficulty).toBe('Beginner');
  });

  it('filters by Advanced difficulty', () => {
    const out = selectDailyQuestion({
      bank,
      answeredIds: [],
      difficulty: 'Advanced',
      todayISO: '2026-05-28',
      state: { lastShownIsoDate: null, lastShownQuestionId: null },
    });
    expect(out?.difficulty).toBe('Advanced');
  });

  it('excludes already-answered questions (version-aware keys)', () => {
    const out = selectDailyQuestion({
      bank,
      // Keyed (id, version) — the bank's questions are all v1.
      answeredIds: [answeredKey('beg-1', 1), answeredKey('beg-2', 1)],
      difficulty: 'Beginner',
      todayISO: '2026-05-28',
      state: { lastShownIsoDate: null, lastShownQuestionId: null },
    });
    expect(out?.id).toBe('beg-3');
  });

  it('re-prompts a question whose version was bumped after it was answered (v1.2 correction)', () => {
    // The user answered beg-1 at v1; a content correction ships beg-1 at v2.
    // The old v1 key no longer matches the current v2 question → it is eligible
    // again. (Restrict the pool to beg-1 so the assertion is unambiguous.)
    const correctedBank = [q('beg-1', 'Beginner')].map((b) => ({ ...b, version: 2 }));
    const out = selectDailyQuestion({
      bank: correctedBank,
      answeredIds: [answeredKey('beg-1', 1)], // only the OLD version was answered
      difficulty: 'Beginner',
      todayISO: '2026-05-28',
      state: { lastShownIsoDate: null, lastShownQuestionId: null },
    });
    expect(out?.id).toBe('beg-1');
    expect(out?.version).toBe(2);
  });

  it('is stable within a day for the same inputs', () => {
    const args = {
      bank,
      answeredIds: [] as string[],
      difficulty: 'Beginner' as const,
      todayISO: '2026-05-28',
      state: { lastShownIsoDate: null, lastShownQuestionId: null },
    };
    expect(selectDailyQuestion(args)?.id).toBe(selectDailyQuestion(args)?.id);
  });

  it('returns null when the eligible pool is exhausted', () => {
    const out = selectDailyQuestion({
      bank,
      answeredIds: [answeredKey('beg-1', 1), answeredKey('beg-2', 1), answeredKey('beg-3', 1)],
      difficulty: 'Beginner',
      todayISO: '2026-05-28',
      state: { lastShownIsoDate: null, lastShownQuestionId: null },
    });
    expect(out).toBeNull();
  });

  it('Mixed mode can draw from both pools', () => {
    // Across many days, Mixed should yield at least one of each tier.
    const seen = new Set<string>();
    for (let day = 1; day <= 60; day++) {
      const iso = `2026-07-${String(day).padStart(2, '0')}`;
      const out = selectDailyQuestion({
        bank,
        answeredIds: [],
        difficulty: 'Mixed',
        todayISO: iso,
        state: { lastShownIsoDate: null, lastShownQuestionId: null },
      });
      if (out) seen.add(out.difficulty);
    }
    expect(seen.has('Beginner')).toBe(true);
    expect(seen.has('Advanced')).toBe(true);
  });
});

describe('selectDailySet', () => {
  // A rich reviewed pool: ≥2 Beginner + ≥2 Advanced across ≥4 topics.
  const richBank: TriviaQuestion[] = [
    qt('beg-found', 'Beginner', Topic.FOUNDATIONS),
    qt('beg-budget', 'Beginner', Topic.BUDGETING),
    qt('beg-savings', 'Beginner', Topic.SAVINGS),
    qt('beg-spend', 'Beginner', Topic.SPENDING),
    qt('adv-invest', 'Advanced', Topic.INVESTMENTS),
    qt('adv-tax', 'Advanced', Topic.TAXES),
    qt('adv-retire', 'Advanced', Topic.RETIREMENT),
    qt('adv-insure', 'Advanced', Topic.INSURANCE),
  ];

  it('returns exactly 4 from a rich pool', () => {
    const set = selectDailySet({ bank: richBank, answeredIds: [], todayISO: '2026-06-01' });
    expect(set).toHaveLength(4);
  });

  it('returns 2 Beginner + 2 Advanced', () => {
    const set = selectDailySet({ bank: richBank, answeredIds: [], todayISO: '2026-06-01' });
    expect(set.filter((x) => x.difficulty === 'Beginner')).toHaveLength(2);
    expect(set.filter((x) => x.difficulty === 'Advanced')).toHaveLength(2);
  });

  it('does not repeat a topic within the 4 (topic-aware)', () => {
    const set = selectDailySet({ bank: richBank, answeredIds: [], todayISO: '2026-06-01' });
    const topics = set.map((x) => x.topic);
    expect(new Set(topics).size).toBe(topics.length);
  });

  it('is deterministic per day — same args twice yields the same 4 ids in order', () => {
    const a = selectDailySet({ bank: richBank, answeredIds: [], todayISO: '2026-06-01' });
    const b = selectDailySet({ bank: richBank, answeredIds: [], todayISO: '2026-06-01' });
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
  });

  it('varies across days — not the same 4 every day', () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 28; d++) {
      const iso = `2026-06-${String(d).padStart(2, '0')}`;
      const set = selectDailySet({ bank: richBank, answeredIds: [], todayISO: iso });
      seen.add(set.map((x) => x.id).join(','));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('excludes prior-day-answered questions (version-aware keys)', () => {
    const set = selectDailySet({
      bank: richBank,
      answeredIds: [answeredKey('beg-found', 1), answeredKey('adv-invest', 1)],
      todayISO: '2026-06-01',
    });
    const ids = set.map((x) => x.id);
    expect(ids).not.toContain('beg-found');
    expect(ids).not.toContain('adv-invest');
  });

  it('keeps today-answered questions IN the set (mid-day stability)', () => {
    const base = selectDailySet({ bank: richBank, answeredIds: [], todayISO: '2026-06-01' });
    const firstId = base[0].id;
    const firstVersion = base[0].version;
    // Answering one of the 4 today must NOT re-roll the set — same 4 ids.
    const after = selectDailySet({
      bank: richBank,
      answeredIds: [],
      answeredTodayIds: [answeredKey(firstId, firstVersion)],
      todayISO: '2026-06-01',
    });
    expect(after.map((x) => x.id)).toEqual(base.map((x) => x.id));
  });

  it('degrades to 3 when only 3 are eligible (no throw, no dupe-padding)', () => {
    const thin = [
      qt('beg-1', 'Beginner', Topic.FOUNDATIONS),
      qt('beg-2', 'Beginner', Topic.BUDGETING),
      qt('adv-1', 'Advanced', Topic.TAXES),
    ];
    const set = selectDailySet({ bank: thin, answeredIds: [], todayISO: '2026-06-01' });
    expect(set).toHaveLength(3);
    expect(new Set(set.map((x) => x.id)).size).toBe(3);
  });

  it('returns [] when the pool is empty', () => {
    expect(selectDailySet({ bank: [], answeredIds: [], todayISO: '2026-06-01' })).toEqual([]);
  });

  it('returns just the 2 Beginner when there are 0 Advanced', () => {
    const noAdv = [
      qt('beg-1', 'Beginner', Topic.FOUNDATIONS),
      qt('beg-2', 'Beginner', Topic.BUDGETING),
    ];
    const set = selectDailySet({ bank: noAdv, answeredIds: [], todayISO: '2026-06-01' });
    expect(set).toHaveLength(2);
    expect(set.every((x) => x.difficulty === 'Beginner')).toBe(true);
  });

  // L1.5 — the 1→4 rollout continuum is just the set size as the pool grows.
  it('rollout continuum: pool of 1 → 1; 1B+1A → 2; rich → 4', () => {
    const one = [qt('beg-1', 'Beginner', Topic.FOUNDATIONS)];
    expect(selectDailySet({ bank: one, answeredIds: [], todayISO: '2026-06-01' })).toHaveLength(1);
    const two = [
      qt('beg-1', 'Beginner', Topic.FOUNDATIONS),
      qt('adv-1', 'Advanced', Topic.TAXES),
    ];
    expect(selectDailySet({ bank: two, answeredIds: [], todayISO: '2026-06-01' })).toHaveLength(2);
    expect(
      selectDailySet({ bank: richBank, answeredIds: [], todayISO: '2026-06-01' }),
    ).toHaveLength(4);
  });

  it('only draws from the pool it is given (caller passes reviewed-only)', () => {
    // selectDailySet does not itself filter by reviewed — that is load-bank's job.
    // Given a pool, every returned question is from that pool.
    const set = selectDailySet({ bank: richBank, answeredIds: [], todayISO: '2026-06-01' });
    const ids = new Set(richBank.map((x) => x.id));
    expect(set.every((x) => ids.has(x.id))).toBe(true);
  });
});

describe('nextStreak', () => {
  it('starts at 1 on the first ever answer', () => {
    expect(nextStreak({ current: 0, lastAnsweredISO: null, todayISO: '2026-05-28' })).toBe(1);
  });
  it('increments on a consecutive day', () => {
    expect(nextStreak({ current: 6, lastAnsweredISO: '2026-05-27', todayISO: '2026-05-28' })).toBe(7);
  });
  it('resets to 1 after a missed day', () => {
    expect(nextStreak({ current: 6, lastAnsweredISO: '2026-05-25', todayISO: '2026-05-28' })).toBe(1);
  });
  it('is idempotent when already answered today', () => {
    expect(nextStreak({ current: 7, lastAnsweredISO: '2026-05-28', todayISO: '2026-05-28' })).toBe(7);
  });

  // L1.2 — ≥1-of-4 participation contract. With the 4-set, the streak advances
  // when you answer your FIRST question of the day; answering the 2nd/3rd/4th the
  // same day is the idempotent no-op. This falls out of the existing model — the
  // change is at the CALL SITE (Learn fires nextStreak per answer; only the first
  // of the day moves it), so nextStreak itself needs no logic change. Pin the
  // intent here so a future refactor can't silently make a 2nd same-day answer
  // double-count.
  describe('≥1-of-4 participation contract', () => {
    it('answering question 1 of 4 today (lastAnswered=yesterday) advances the streak', () => {
      expect(
        nextStreak({ current: 3, lastAnsweredISO: '2026-05-31', todayISO: '2026-06-01' }),
      ).toBe(4);
    });
    it('answering question 2/3/4 of 4 the same day is the idempotent no-op', () => {
      // After the first answer, lastAnswered === today; subsequent answers hit
      // the same-day branch and never move the streak.
      const afterFirst = nextStreak({
        current: 3,
        lastAnsweredISO: '2026-05-31',
        todayISO: '2026-06-01',
      });
      expect(afterFirst).toBe(4);
      expect(
        nextStreak({ current: afterFirst, lastAnsweredISO: '2026-06-01', todayISO: '2026-06-01' }),
      ).toBe(4); // 2nd
      expect(
        nextStreak({ current: afterFirst, lastAnsweredISO: '2026-06-01', todayISO: '2026-06-01' }),
      ).toBe(4); // 3rd / 4th — still no double-count
    });
    it('first-ever answer → 1; a gap → 1', () => {
      expect(nextStreak({ current: 0, lastAnsweredISO: null, todayISO: '2026-06-01' })).toBe(1);
      expect(nextStreak({ current: 9, lastAnsweredISO: '2026-05-20', todayISO: '2026-06-01' })).toBe(
        1,
      );
    });
  });
});
