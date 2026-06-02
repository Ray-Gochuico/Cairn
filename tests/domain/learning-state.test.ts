import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { LearningStateRepo } from '@/domain/learning-state';

const loadInitial = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadLearning = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0037_learning_state.sql'), 'utf-8');

describe('LearningStateRepo', () => {
  let db: SqliteAdapter;
  let repo: LearningStateRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitial() },
      { version: '0037_learning_state', sql: loadLearning() },
    ]);
    repo = new LearningStateRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns the seeded singleton with defaults', async () => {
    const s = await repo.get();
    expect(s.id).toBe(1);
    expect(s.difficultyPreference).toBe('Beginner');
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
    expect(await repo.countAnswered()).toBe(1);
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
    expect(await repo.countAnswered()).toBe(1);
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
    expect(await repo.countAnswered()).toBe(2);
    expect((await repo.listAnsweredQuestionIds()).sort()).toEqual(['beg-apr@v1', 'beg-apr@v2']);
  });

  // L1.0 — date-aware producer for the derive anchor (§3.0). Partitions the
  // answered set into prior-day (EXCLUDE from the day's 4-set) vs today (KEEP in
  // the set, shown greyed). Derives off learning_answers.answered_iso_date — no
  // migration.
  describe('getAnsweredKeysByDay', () => {
    it('returns {priorDays:[], today:[]} for an empty table', async () => {
      expect(await repo.getAnsweredKeysByDay('2026-06-01')).toEqual({ priorDays: [], today: [] });
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
  });
});
