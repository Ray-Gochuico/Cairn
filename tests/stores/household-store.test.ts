import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import { FilingStatus } from '@/types/enums';

describe('useHouseholdStore', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    // Full migration chain so HouseholdRepo.update() sees the 0018
    // roadmap rule-engine columns and doesn't throw on "no such column".
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('loads the household from the database', async () => {
    await useHouseholdStore.getState().load();
    const { household } = useHouseholdStore.getState();
    expect(household).not.toBeNull();
    expect(household!.filingStatus).toBe(FilingStatus.SINGLE);
  });

  it('updates the household and refreshes state', async () => {
    await useHouseholdStore.getState().load();
    await useHouseholdStore.getState().update({
      filingStatus: FilingStatus.MFJ,
      state: 'WA',
      monthlyExpenseBaseline: 7000,
    });
    const { household } = useHouseholdStore.getState();
    expect(household!.filingStatus).toBe(FilingStatus.MFJ);
    expect(household!.state).toBe('WA');
    expect(household!.monthlyExpenseBaseline).toBe(7000);
  });

  it('sets error state on invalid update', async () => {
    await useHouseholdStore.getState().load();
    try {
      await useHouseholdStore.getState().update({ withdrawalRate: 5.0 } as any);
    } catch {
      /* expected */
    }
    const { error } = useHouseholdStore.getState();
    expect(error).not.toBeNull();
  });
});

describe('useHouseholdStore — acceptDisclaimer', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    // Need all migrations so disclosure columns + audit table exist.
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
    await useHouseholdStore.getState().load();
  });

  afterEach(async () => {
    await db.close();
  });

  it('writes the cache columns on household and refreshes the store', async () => {
    await useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.0');
    const { household } = useHouseholdStore.getState();
    expect(household!.disclaimerVersionAccepted).toBe('1.0');
    expect(household!.disclaimerAcceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('appends a row to disclosure_acceptances', async () => {
    await useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.0');
    const rows = await db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM disclosure_acceptances WHERE document_id = 'app_wide'`,
    );
    expect(rows[0].count).toBe(1);
  });

  it('keeps app_wide and roadmap cache columns independent', async () => {
    await useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.0');
    await useHouseholdStore.getState().acceptDisclaimer('roadmap', '1.0');
    const { household } = useHouseholdStore.getState();
    expect(household!.disclaimerVersionAccepted).toBe('1.0');
    expect(household!.roadmapDisclaimerVersionAccepted).toBe('1.0');
  });

  it('is safe to call twice with the same version (idempotent audit insert)', async () => {
    await useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.0');
    await useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.0');
    const rows = await db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM disclosure_acceptances WHERE document_id = 'app_wide' AND version = '1.0'`,
    );
    expect(rows[0].count).toBe(1);
  });

  it('records a fresh audit row when the user accepts a newer version', async () => {
    await useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.0');
    await useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.1');
    const rows = await db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM disclosure_acceptances WHERE document_id = 'app_wide'`,
    );
    expect(rows[0].count).toBe(2);
    const { household } = useHouseholdStore.getState();
    expect(household!.disclaimerVersionAccepted).toBe('1.1');
  });
});
