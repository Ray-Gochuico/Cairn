import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useLearningStore } from '@/stores/learning-state-store';

const loadInitial = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadLearning = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0037_learning_state.sql'), 'utf-8');
const loadPreferenceDefault = () =>
  readFileSync(
    resolve(__dirname, '../../src/db/migrations/0048_learning_preference_default.sql'),
    'utf-8',
  );

describe('useLearningStore', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    // Clock-free (Wave 8 policy ratchet): pin 'today' so the partition test
    // can use a literal ISO date instead of reading the real clock.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 7, 12, 0, 0));
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitial() },
      { version: '0037_learning_state', sql: loadLearning() },
      { version: '0048_learning_preference_default', sql: loadPreferenceDefault() },
    ]);
    setDatabase(db);
    useLearningStore.setState({
      learningState: null,
      answeredQuestionIds: [],
      answeredKeysByDay: { priorDays: [], today: [], todayDetails: [] },
      answeredStats: null,
      isLoading: false,
      error: null,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.close();
  });

  it('loads the seeded state + empty answer list', async () => {
    await useLearningStore.getState().load();
    expect(useLearningStore.getState().learningState?.difficultyPreference).toBe('Mixed');
    expect(useLearningStore.getState().answeredQuestionIds).toEqual([]);
  });

  it('updates the difficulty preference', async () => {
    await useLearningStore.getState().load();
    await useLearningStore.getState().update({ difficultyPreference: 'Advanced' });
    expect(useLearningStore.getState().learningState?.difficultyPreference).toBe('Advanced');
  });

  it('records an answer and refreshes answeredQuestionIds (version-aware keys)', async () => {
    await useLearningStore.getState().load();
    await useLearningStore.getState().recordAnswer({
      questionId: 'beg-apr',
      answeredIsoDate: '2026-05-28',
      chosenIndex: 0,
      wasCorrect: true,
      questionVersion: 1,
    });
    // The store mirrors the repo's version-aware keys (`id@vN`), which the daily
    // selector matches against the current bank's (id, version).
    expect(useLearningStore.getState().answeredQuestionIds).toEqual(['beg-apr@v1']);
  });

  it('a failed recordAnswer lands in state.error instead of an unhandled rejection (W10 chip)', async () => {
    await useLearningStore.getState().load();
    await db.close(); // the next repo write will throw
    await useLearningStore.getState().recordAnswer({
      questionId: 'beg-apr',
      answeredIsoDate: '2026-05-28',
      chosenIndex: 0,
      wasCorrect: true,
      questionVersion: 1,
    });
    expect(useLearningStore.getState().error).not.toBeNull();
  });

  it('exposes date-partitioned answeredKeysByDay (prior-day vs today)', async () => {
    const today = '2026-07-07';
    await useLearningStore.getState().load();
    // A prior-day answer and a today answer.
    await useLearningStore.getState().recordAnswer({
      questionId: 'beg-apr',
      answeredIsoDate: '2020-01-01',
      chosenIndex: 0,
      wasCorrect: true,
      questionVersion: 1,
    });
    await useLearningStore.getState().recordAnswer({
      questionId: 'beg-apy',
      answeredIsoDate: today,
      chosenIndex: 1,
      wasCorrect: true,
      questionVersion: 1,
    });
    const { answeredKeysByDay } = useLearningStore.getState();
    expect(answeredKeysByDay.priorDays).toEqual(['beg-apr@v1']);
    expect(answeredKeysByDay.today).toEqual(['beg-apy@v1']);
  });

  it('recordAnswer with a statePatch folds the streak write into ONE store refresh', async () => {
    await useLearningStore.getState().load();
    await useLearningStore.getState().recordAnswer(
      { questionId: 'beg-apr', answeredIsoDate: '2026-07-07', chosenIndex: 1, wasCorrect: false, questionVersion: 1 },
      { streakCount: 1, lastAnsweredIsoDate: '2026-07-07' },
    );
    const s = useLearningStore.getState();
    expect(s.learningState?.streakCount).toBe(1);
    expect(s.learningState?.lastAnsweredIsoDate).toBe('2026-07-07');
    expect(s.answeredKeysByDay.today).toEqual(['beg-apr@v1']);
    expect(s.answeredKeysByDay.todayDetails).toEqual([{ key: 'beg-apr@v1', chosenIndex: 1 }]);
    expect(s.answeredStats).toEqual({ answered: 1, correct: 0 });
  });

  it('recordAnswer without a patch still refreshes (back-compat single-arg call)', async () => {
    await useLearningStore.getState().load();
    await useLearningStore.getState().recordAnswer({
      questionId: 'beg-apy',
      answeredIsoDate: '2026-07-07',
      chosenIndex: 0,
      wasCorrect: true,
      questionVersion: 1,
    });
    expect(useLearningStore.getState().answeredStats).toEqual({ answered: 1, correct: 1 });
  });
});
