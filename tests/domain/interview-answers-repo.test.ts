import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { InterviewAnswersRepo } from '@/domain/interview-answers-repo';

describe('InterviewAnswersRepo', () => {
  let db: SqliteAdapter;
  let repo: InterviewAnswersRepo;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
    repo = new InterviewAnswersRepo(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it('starts empty', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('upsert inserts, then replaces in place on the same (household, thread, question, subject)', async () => {
    await repo.upsert({
      householdId: 1, threadId: 'vehicle_replacement', questionId: 'q_keep_horizon',
      subjectKey: 'vehicle:3', valueJson: '"no-plans"', questionVersion: 1,
      answeredAt: '2026-08-01T00:00:00.000Z', basisJson: '{"branch":"signal"}',
    });
    await repo.upsert({
      householdId: 1, threadId: 'vehicle_replacement', questionId: 'q_keep_horizon',
      subjectKey: 'vehicle:3', valueJson: '"replace-within-2y"', questionVersion: 2,
      answeredAt: '2026-08-02T00:00:00.000Z', basisJson: '{"branch":"signal"}',
    });
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].valueJson).toBe('"replace-within-2y"');
    expect(all[0].questionVersion).toBe(2);
    expect(all[0].answeredAt).toBe('2026-08-02T00:00:00.000Z');
  });

  it('subject_key disambiguates instances of the same question', async () => {
    const base = {
      householdId: 1, threadId: 'vehicle_replacement', questionId: 'q_keep_horizon',
      valueJson: '"no-plans"', questionVersion: 1, answeredAt: '2026-08-01T00:00:00.000Z', basisJson: null,
    };
    await repo.upsert({ ...base, subjectKey: 'vehicle:1' });
    await repo.upsert({ ...base, subjectKey: 'vehicle:2' });
    expect(await repo.list()).toHaveLength(2);
  });

  it('delete removes exactly one keyed row; deleting a missing row is a no-op', async () => {
    await repo.upsert({
      householdId: 1, threadId: 't', questionId: 'q', subjectKey: '',
      valueJson: '1', questionVersion: 1, answeredAt: '2026-08-01T00:00:00.000Z', basisJson: null,
    });
    await repo.delete(1, 't', 'q', 'missing');
    expect(await repo.list()).toHaveLength(1);
    await repo.delete(1, 't', 'q', '');
    expect(await repo.list()).toEqual([]);
  });
});
