import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { LearningStateRepo } from '@/domain/learning-state';
import { selectDailySet } from '@/lib/trivia/daily';
import { answeredKey } from '@/lib/trivia/answered-key';
import { QuestionFormat, Topic } from '@/types/enums';
import type { TriviaQuestion } from '@/lib/trivia/bank-schema';

const loadInitial = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadLearning = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0037_learning_state.sql'), 'utf-8');
const loadPreferenceDefault = () =>
  readFileSync(
    resolve(__dirname, '../../src/db/migrations/0048_learning_preference_default.sql'),
    'utf-8',
  );

describe('LearningStateRepo', () => {
  let db: SqliteAdapter;
  let repo: LearningStateRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitial() },
      { version: '0037_learning_state', sql: loadLearning() },
      { version: '0048_learning_preference_default', sql: loadPreferenceDefault() },
    ]);
    repo = new LearningStateRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns the seeded singleton with defaults', async () => {
    const s = await repo.get();
    expect(s.id).toBe(1);
    expect(s.difficultyPreference).toBe('Mixed');
    expect(s.streakCount).toBe(0);
    expect(s.lastShownQuestionId).toBeNull();
    expect(s.lastShownIsoDate).toBeNull();
    expect(s.lastAnsweredIsoDate).toBeNull();
  });

  it('updates a subset of fields', async () => {
    await repo.update({
      difficultyPreference: 'Mixed',
      lastShownQuestionId: 'beg-apr',
      lastShownIsoDate: '2026-05-28',
      streakCount: 3,
      lastAnsweredIsoDate: '2026-05-28',
    });
    const s = await repo.get();
    expect(s.difficultyPreference).toBe('Mixed');
    expect(s.lastShownQuestionId).toBe('beg-apr');
    expect(s.streakCount).toBe(3);
  });

  it('records an answer and lists version-aware answered keys', async () => {
    await repo.recordAnswer({
      questionId: 'beg-apr',
      answeredIsoDate: '2026-05-28',
      chosenIndex: 0,
      wasCorrect: true,
      questionVersion: 1,
    });
    // Keyed (id, version): `beg-apr@v1`, not the bare id.
    expect(await repo.listAnsweredQuestionIds()).toEqual(['beg-apr@v1']);
    expect(await repo.answeredStats()).toEqual({ answered: 1, correct: 1 });
  });

  it('treats a same-(id, version) re-answer as a no-op (one-shot per version)', async () => {
    const a = {
      questionId: 'beg-apr',
      answeredIsoDate: '2026-05-28',
      chosenIndex: 0,
      wasCorrect: true,
      questionVersion: 1,
    };
    await repo.recordAnswer(a);
    await expect(
      repo.recordAnswer({ ...a, answeredIsoDate: '2026-05-29', chosenIndex: 1, wasCorrect: false }),
    ).resolves.not.toThrow();
    // The duplicate write is a no-op: still one row, still one correct.
    expect(await repo.answeredStats()).toEqual({ answered: 1, correct: 1 });
  });

  it('records a bumped version as a new row (v1.2 re-prompt after a content correction)', async () => {
    const v1 = {
      questionId: 'beg-apr',
      answeredIsoDate: '2026-05-28',
      chosenIndex: 0,
      wasCorrect: true,
      questionVersion: 1,
    };
    await repo.recordAnswer(v1);
    // Same question, version bumped after a correction — answerable again.
    await repo.recordAnswer({ ...v1, answeredIsoDate: '2026-06-01', questionVersion: 2 });
    expect(await repo.answeredStats()).toEqual({ answered: 2, correct: 2 });
    expect((await repo.listAnsweredQuestionIds()).sort()).toEqual(['beg-apr@v1', 'beg-apr@v2']);
  });

  it('answeredStats aggregates was_correct (the all-time progress line)', async () => {
    await repo.recordAnswer({ questionId: 'a', answeredIsoDate: '2026-07-01', chosenIndex: 0, wasCorrect: true, questionVersion: 1 });
    await repo.recordAnswer({ questionId: 'b', answeredIsoDate: '2026-07-02', chosenIndex: 1, wasCorrect: false, questionVersion: 1 });
    await repo.recordAnswer({ questionId: 'c', answeredIsoDate: '2026-07-03', chosenIndex: 2, wasCorrect: true, questionVersion: 1 });
    expect(await repo.answeredStats()).toEqual({ answered: 3, correct: 2 });
  });

  // L1.0 — date-aware producer for the derive anchor (§3.0). Partitions the
  // answered set into prior-day (EXCLUDE from the day's 4-set) vs today (KEEP in
  // the set, shown greyed). Derives off learning_answers.answered_iso_date — no
  // migration.
  describe('getAnsweredKeysByDay', () => {
    it('returns {priorDays:[], today:[]} for an empty table', async () => {
      expect(await repo.getAnsweredKeysByDay('2026-06-01')).toEqual({
        priorDays: [],
        today: [],
        todayDetails: [],
      });
    });

    it('partitions prior-day vs today keys (version-aware)', async () => {
      await repo.recordAnswer({
        questionId: 'beg-apr',
        answeredIsoDate: '2026-05-31',
        chosenIndex: 0,
        wasCorrect: true,
        questionVersion: 1,
      });
      await repo.recordAnswer({
        questionId: 'beg-apy',
        answeredIsoDate: '2026-06-01',
        chosenIndex: 1,
        wasCorrect: true,
        questionVersion: 1,
      });
      const out = await repo.getAnsweredKeysByDay('2026-06-01');
      expect(out.priorDays).toEqual(['beg-apr@v1']);
      expect(out.today).toEqual(['beg-apy@v1']);
    });

    it('keys a bumped-version same-day answer as id@v2', async () => {
      await repo.recordAnswer({
        questionId: 'beg-apr',
        answeredIsoDate: '2026-06-01',
        chosenIndex: 0,
        wasCorrect: true,
        questionVersion: 2,
      });
      const out = await repo.getAnsweredKeysByDay('2026-06-01');
      expect(out.today).toEqual(['beg-apr@v2']);
      expect(out.priorDays).toEqual([]);
    });

    it("returns today's chosen_index per key (todayDetails) for graded-reveal rehydration", async () => {
      await repo.recordAnswer({
        questionId: 'beg-apr', answeredIsoDate: '2026-07-07', chosenIndex: 2, wasCorrect: false, questionVersion: 1,
      });
      await repo.recordAnswer({
        questionId: 'adv-tax', answeredIsoDate: '2026-07-06', chosenIndex: 0, wasCorrect: true, questionVersion: 1,
      });
      const { todayDetails } = await repo.getAnsweredKeysByDay('2026-07-07');
      expect(todayDetails).toEqual([{ key: 'beg-apr@v1', chosenIndex: 2 }]); // prior-day rows excluded
    });
  });

  // L1.1 mid-day stability, wired from the REAL producer (panel Testing H2) —
  // derive the 4-set, record an answer to one of them with answered_iso_date =
  // today, re-fetch getAnsweredKeysByDay, re-derive, and assert the SAME 4 ids
  // (the just-answered one now lives in `today` and stays in the set). This is
  // the key regression guard for the derive model.
  describe('selectDailySet wired to getAnsweredKeysByDay (mid-day stability)', () => {
    const TODAY = '2026-06-01';
    const qt = (id: string, difficulty: 'Beginner' | 'Advanced', topic: Topic): TriviaQuestion => ({
      id,
      version: 1,
      difficulty,
      format: QuestionFormat.DEFINITION,
      topic,
      prompt: `p ${id}`,
      choices: ['a', 'b', 'c', 'd'],
      answerIndex: 0,
      explanation: 'e',
      source: 'src',
      reviewed: true,
    });
    const richBank: TriviaQuestion[] = [
      qt('beg-found', 'Beginner', Topic.FOUNDATIONS),
      qt('beg-budget', 'Beginner', Topic.BUDGETING),
      qt('adv-invest', 'Advanced', Topic.INVESTMENTS),
      qt('adv-tax', 'Advanced', Topic.TAXES),
    ];

    it('keeps the same 4 ids after answering one of them today', async () => {
      const before = await repo.getAnsweredKeysByDay(TODAY);
      const initial = selectDailySet({
        bank: richBank,
        answeredIds: before.priorDays,
        answeredTodayIds: before.today,
        todayISO: TODAY,
      });
      expect(initial).toHaveLength(4);

      // Answer the first of the 4 TODAY.
      const target = initial[0];
      await repo.recordAnswer({
        questionId: target.id,
        answeredIsoDate: TODAY,
        chosenIndex: target.answerIndex,
        wasCorrect: true,
        questionVersion: target.version,
      });

      const after = await repo.getAnsweredKeysByDay(TODAY);
      expect(after.today).toContain(answeredKey(target.id, target.version));
      const reDerived = selectDailySet({
        bank: richBank,
        answeredIds: after.priorDays,
        answeredTodayIds: after.today,
        todayISO: TODAY,
      });
      expect(reDerived.map((x) => x.id)).toEqual(initial.map((x) => x.id));
    });
  });
});
