import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useLearningStore } from '@/stores/learning-state-store';
import { localTodayISO } from '@/lib/trivia/daily';

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
      answeredKeysByDay: { priorDays: [], today: [] },
      isLoading: false,
      error: null,
    });
  });

  afterEach(async () => {
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

  it('exposes date-partitioned answeredKeysByDay (prior-day vs today)', async () => {
    const today = localTodayISO(new Date());
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
});
