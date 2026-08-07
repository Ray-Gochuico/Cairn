import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useInterviewAnswersStore } from '@/stores/interview-answers-store';
import { useHouseholdStore } from '@/stores/household-store';

// NOTE: the plan's search hint said to mock the getDatabase module; the house
// idiom in tests/stores/ is setDatabase(db) from @/db/db — used here instead.

describe('interview-answers-store', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00Z'));
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useInterviewAnswersStore.setState({ answersByKey: new Map(), isLoading: false, error: null });
    useHouseholdStore.setState({ household: { id: 1 } } as never);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await db.close();
  });

  it('saveAnswer upserts and reloads the keyed map, stamping answeredAt + basis', async () => {
    await useInterviewAnswersStore.getState().saveAnswer({
      threadId: 'vehicle_replacement', questionId: 'q_keep_horizon', subjectKey: 'vehicle:3',
      value: 'no-plans', questionVersion: 1, basis: { branch: 'signal', vehicleId: 3 },
    });
    const row = useInterviewAnswersStore.getState()
      .answersByKey.get('vehicle_replacement/q_keep_horizon/vehicle:3');
    expect(row).toBeDefined();
    expect(row!.valueJson).toBe('"no-plans"');
    expect(row!.answeredAt).toBe('2026-08-01T12:00:00.000Z');
    expect(JSON.parse(row!.basisJson!)).toEqual({ branch: 'signal', vehicleId: 3 });
  });

  it('clearAnswer deletes the row (the "Ask me again" affordance)', async () => {
    const s = useInterviewAnswersStore.getState();
    await s.saveAnswer({
      threadId: 't', questionId: 'q', subjectKey: '', value: 1, questionVersion: 1, basis: null,
    });
    await useInterviewAnswersStore.getState().clearAnswer('t', 'q', '');
    expect(useInterviewAnswersStore.getState().answersByKey.size).toBe(0);
  });
});
