import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { DisclosureAcceptancesRepo } from '@/domain/disclosure-acceptances';

describe('DisclosureAcceptancesRepo', () => {
  let db: SqliteAdapter;
  let repo: DisclosureAcceptancesRepo;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
    repo = new DisclosureAcceptancesRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('records a new acceptance row', async () => {
    await repo.record({
      householdId: 1,
      documentId: 'app_wide',
      version: '1.0',
      acceptedAt: '2026-05-23T12:00:00Z',
    });
    const rows = await db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM disclosure_acceptances`,
    );
    expect(rows[0].count).toBe(1);
  });

  it('is idempotent for the same (household, document, version)', async () => {
    await repo.record({
      householdId: 1,
      documentId: 'app_wide',
      version: '1.0',
      acceptedAt: '2026-05-23T12:00:00Z',
    });
    await repo.record({
      householdId: 1,
      documentId: 'app_wide',
      version: '1.0',
      acceptedAt: '2026-05-24T12:00:00Z',
    });
    const rows = await db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM disclosure_acceptances`,
    );
    expect(rows[0].count).toBe(1);
  });

  it('records a different version of the same document as a new row', async () => {
    await repo.record({
      householdId: 1,
      documentId: 'app_wide',
      version: '1.0',
      acceptedAt: '2026-05-23T12:00:00Z',
    });
    await repo.record({
      householdId: 1,
      documentId: 'app_wide',
      version: '1.1',
      acceptedAt: '2026-05-24T12:00:00Z',
    });
    const rows = await db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM disclosure_acceptances`,
    );
    expect(rows[0].count).toBe(2);
  });

  it('latestForDocument returns the most recently-accepted version', async () => {
    await repo.record({ householdId: 1, documentId: 'app_wide', version: '1.0', acceptedAt: '2026-05-23T12:00:00Z' });
    await repo.record({ householdId: 1, documentId: 'app_wide', version: '1.1', acceptedAt: '2026-05-24T12:00:00Z' });
    const latest = await repo.latestForDocument('app_wide');
    expect(latest).not.toBeNull();
    expect(latest!.version).toBe('1.1');
    expect(latest!.documentId).toBe('app_wide');
  });

  it('latestForDocument returns null when no acceptance exists', async () => {
    const latest = await repo.latestForDocument('roadmap');
    expect(latest).toBeNull();
  });

  it('keeps app_wide and roadmap streams independent', async () => {
    await repo.record({ householdId: 1, documentId: 'app_wide', version: '1.0', acceptedAt: '2026-05-23T12:00:00Z' });
    await repo.record({ householdId: 1, documentId: 'roadmap', version: '1.0', acceptedAt: '2026-05-23T13:00:00Z' });
    const all = await repo.allForDocument('app_wide');
    expect(all).toHaveLength(1);
    expect(all[0].documentId).toBe('app_wide');
  });
});
