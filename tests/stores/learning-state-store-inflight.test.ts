/**
 * In-flight de-dupe: concurrent load() calls must collapse to one DB read;
 * a load() after settle must re-query (mutations stay visible). Mirrors
 * accounts-store-inflight.test.ts — wave-6 C3 migrates this store onto
 * createDedupedLoadPartial (one load lands three state fields). The store's
 * own fetch reads the clock (localTodayISO(new Date())) — that is SOURCE
 * code; this test file stays clock-free.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useLearningStore } from '@/stores/learning-state-store';
import { LearningStateRepo } from '@/domain/learning-state';

describe('useLearningStore in-flight de-dupe', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
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

  it('two concurrent load() calls hit the underlying repo read only once', async () => {
    const spy = vi.spyOn(LearningStateRepo.prototype, 'get');
    const p1 = useLearningStore.getState().load();
    const p2 = useLearningStore.getState().load();
    await Promise.all([p1, p2]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('a load() after the previous one settles triggers a fresh DB query', async () => {
    const spy = vi.spyOn(LearningStateRepo.prototype, 'get');
    await useLearningStore.getState().load();
    await useLearningStore.getState().load();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
