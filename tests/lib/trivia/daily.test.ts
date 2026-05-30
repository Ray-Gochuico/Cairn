import { describe, it, expect } from 'vitest';
import {
  localTodayISO,
  yesterday,
  selectDailyQuestion,
  nextStreak,
} from '@/lib/trivia/daily';
import { answeredKey } from '@/lib/trivia/answered-key';
import type { TriviaQuestion } from '@/lib/trivia/bank-schema';

const q = (id: string, difficulty: 'Beginner' | 'Advanced'): TriviaQuestion => ({
  id,
  version: 1,
  difficulty,
  tags: [],
  prompt: `prompt ${id}`,
  choices: ['a', 'b', 'c', 'd'],
  answerIndex: 0,
  explanation: 'x',
  source: 'src',
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
});
