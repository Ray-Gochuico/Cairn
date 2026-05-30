import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
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

describe('useHouseholdStore — acceptDisclaimer (table-driven, single source of truth MF-1)', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    // Need all migrations so the audit table exists (0017) and the legacy
    // household disclosure columns are dropped (0043).
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
    useAcceptancesStore.setState({ acceptedVersions: {}, status: 'ready', isLoading: false, error: null });
    await useHouseholdStore.getState().load();
  });

  afterEach(async () => {
    await db.close();
  });

  it('writes the audit row and refreshes the acceptances store (no household column)', async () => {
    await useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.0');
    // Source of truth: the audit row.
    const audit = await db.select<{ version: string; accepted_at: string }>(
      `SELECT version, accepted_at FROM disclosure_acceptances WHERE document_id = 'app_wide'`,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].version).toBe('1.0');
    expect(audit[0].accepted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The gate reads the store projection — it reflects the accept.
    expect(useAcceptancesStore.getState().acceptedVersions.app_wide).toBe('1.0');
  });

  it('appends a row to disclosure_acceptances', async () => {
    await useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.0');
    const rows = await db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM disclosure_acceptances WHERE document_id = 'app_wide'`,
    );
    expect(rows[0].count).toBe(1);
  });

  it('keeps app_wide and roadmap acceptances independent in the projection', async () => {
    await useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.0');
    await useHouseholdStore.getState().acceptDisclaimer('roadmap', '1.0');
    const accepted = useAcceptancesStore.getState().acceptedVersions;
    expect(accepted.app_wide).toBe('1.0');
    expect(accepted.roadmap).toBe('1.0');
  });

  it('is safe to call twice with the same version (idempotent audit insert)', async () => {
    await useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.0');
    await useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.0');
    const rows = await db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM disclosure_acceptances WHERE document_id = 'app_wide' AND version = '1.0'`,
    );
    expect(rows[0].count).toBe(1);
  });

  it('records a fresh audit row when the user accepts a newer version; projection shows the latest', async () => {
    await useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.0');
    await useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.1');
    const rows = await db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM disclosure_acceptances WHERE document_id = 'app_wide'`,
    );
    expect(rows[0].count).toBe(2);
    // The projection returns the LATEST accepted version (self-join on max).
    expect(useAcceptancesStore.getState().acceptedVersions.app_wide).toBe('1.1');
  });

  it('flips the projection optimistically with no post-write re-read (resolves, durable, no re-prompt)', async () => {
    // acceptDisclaimer sets the projection directly after the audit write and
    // does NOT re-read: a slow/contended read would otherwise re-enter
    // 'loading' and time out to 'error', re-prompting the user after a
    // successful accept. Prove the accept path has no read dependency by making
    // every projection read throw — the accept must still resolve and flip the
    // gate to a stable 'ready'.
    const spy = vi
      .spyOn(DisclosureAcceptancesRepo.prototype, 'latestVersionsByDocument')
      .mockRejectedValue(new Error('projection read must not be on the accept path'));

    await expect(
      useHouseholdStore.getState().acceptDisclaimer('roadmap', '1.0'),
    ).resolves.toBeUndefined();

    // Projection reflects the acceptance immediately (optimistic), and status
    // is 'ready' — NOT 'loading'/'error' — so the gate does not re-prompt.
    expect(useAcceptancesStore.getState().acceptedVersions.roadmap).toBe('1.0');
    expect(useAcceptancesStore.getState().status).toBe('ready');

    spy.mockRestore();

    // The audit row is durable.
    const auditRows = await db.select<{ version: string }>(
      `SELECT version FROM disclosure_acceptances WHERE document_id = 'roadmap'`,
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].version).toBe('1.0');
  });

  it('leaves the audit table empty when the record write fails (atomic single INSERT; projection unchanged)', async () => {
    // The audit insert is a lone INSERT — atomic on its own, no manual
    // BEGIN/COMMIT wrap (which would be fragile under tauri-plugin-sql's
    // connection pool). If record() throws, no audit row lands and the gate
    // projection is untouched — there is no household column left to roll back.
    const spy = vi
      .spyOn(DisclosureAcceptancesRepo.prototype, 'record')
      .mockRejectedValueOnce(new Error('synthetic audit-write failure'));

    expect(useAcceptancesStore.getState().acceptedVersions.app_wide).toBeUndefined();

    await expect(
      useHouseholdStore.getState().acceptDisclaimer('app_wide', '1.0'),
    ).rejects.toThrow(/synthetic audit-write failure/);

    spy.mockRestore();

    // Audit table must remain empty.
    const auditRows = await db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM disclosure_acceptances WHERE document_id = 'app_wide'`,
    );
    expect(auditRows[0].count).toBe(0);
    // The projection never recorded the version.
    expect(useAcceptancesStore.getState().acceptedVersions.app_wide).toBeUndefined();
  });
});
