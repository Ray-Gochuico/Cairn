import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import { DisclosureAcceptancesRepo } from '@/domain/disclosure-acceptances';
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

  it('Smoke-2026-05-27: post-COMMIT cache refresh failure is non-fatal — acceptance still resolves', async () => {
    // The live Tauri build was observed once where the post-COMMIT
    // `householdRepo.get()` threw after a successful BEGIN/COMMIT
    // (likely a transient tauri-plugin-sql SELECT-after-write race),
    // bubbling up to DisclosureModal as "Failed to record acceptance"
    // even though the acceptance had committed. Symptom-fix: update
    // Zustand optimistically from the values we just committed, then
    // attempt a best-effort refresh that swallows errors.

    // Spy the post-COMMIT read to force it to throw on this call.
    const HouseholdRepoModule = await import('@/domain/household');
    const spy = vi
      .spyOn(HouseholdRepoModule.HouseholdRepo.prototype, 'get')
      // First call is the existing store.load() in beforeEach (already
      // happened) — we only need to fail subsequent calls. mockRejectedValue
      // applies to ALL future calls so we use mockImplementationOnce to
      // target only the post-COMMIT refresh.
      .mockImplementationOnce(async () => {
        throw new Error('synthetic post-commit SELECT race');
      });

    // Should resolve, NOT throw, despite the inner get() failure.
    await expect(
      useHouseholdStore.getState().acceptDisclaimer('roadmap', '1.0'),
    ).resolves.toBeUndefined();

    spy.mockRestore();

    // Optimistic cache update: the gate's selector should now see the
    // version we just accepted, even though the fresh read failed.
    const { household } = useHouseholdStore.getState();
    expect(household!.roadmapDisclaimerVersionAccepted).toBe('1.0');
    expect(household!.roadmapDisclaimerAcceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // DB writes ARE durable — both the cache columns and the audit row
    // landed before the read threw.
    const dbRows = await db.select<{
      roadmap_disclaimer_version_accepted: string | null;
    }>(`SELECT roadmap_disclaimer_version_accepted FROM household WHERE id = 1`);
    expect(dbRows[0].roadmap_disclaimer_version_accepted).toBe('1.0');
    const auditRows = await db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM disclosure_acceptances WHERE document_id = 'roadmap'`,
    );
    expect(auditRows[0].count).toBe(1);
  });

  it('W7-Data #1: rolls back cache columns when the audit insert fails (atomic)', async () => {
    // Pre-fix the two writes ran sequentially without a transaction —
    // if `acceptancesRepo.record` threw after the cache update landed,
    // the household showed "accepted" but the audit trail was empty.
    // The fix wraps the pair in BEGIN/COMMIT (ROLLBACK on throw).

    // Spy + throw on the audit insert. We must spy on the prototype
    // because the store constructs a fresh DisclosureAcceptancesRepo
    // on each call.
    const spy = vi
      .spyOn(DisclosureAcceptancesRepo.prototype, 'record')
      .mockRejectedValueOnce(new Error('synthetic audit-write failure'));

    // Capture the cache-column state before the failing call so we can
    // assert it didn't move.
    const before = useHouseholdStore.getState().household;
    expect(before!.disclaimerVersionAccepted).toBeNull();
    expect(before!.disclaimerAcceptedAt).toBeNull();

    await expect(
      useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.0'),
    ).rejects.toThrow(/synthetic audit-write failure/);

    spy.mockRestore();

    // Cache columns must NOT show the version — the transaction rolled
    // back the household UPDATE when the audit INSERT threw.
    const rows = await db.select<{
      disclaimer_version_accepted: string | null;
      disclaimer_accepted_at: string | null;
    }>(
      `SELECT disclaimer_version_accepted, disclaimer_accepted_at FROM household WHERE id = 1`,
    );
    expect(rows[0].disclaimer_version_accepted).toBeNull();
    expect(rows[0].disclaimer_accepted_at).toBeNull();

    // Audit table must remain empty.
    const auditRows = await db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM disclosure_acceptances WHERE document_id = 'app_wide'`,
    );
    expect(auditRows[0].count).toBe(0);
  });
});
