import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useDisclosureGate } from '@/legal/useDisclosureGate';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { DISCLOSURES } from '@/legal/disclosures';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { DisclosureAcceptancesRepo } from '@/domain/disclosure-acceptances';

// Seed the gate's in-memory projection directly (the gate reads this store,
// MF-1). { documentId: acceptedVersion }. `status: 'ready'` models a completed
// load — the gate keys on acceptedVersions, but seeding the full state keeps
// the store honest (AppDisclaimerGate reads status; TR-2).
function seedAccepted(map: Record<string, string>) {
  useAcceptancesStore.setState({ acceptedVersions: map, status: 'ready', isLoading: false, error: null });
}

describe('useDisclosureGate (table-driven, MF-1)', () => {
  beforeEach(() => {
    useAcceptancesStore.setState({ acceptedVersions: {}, status: 'ready', isLoading: false, error: null });
  });

  it('returns needs-acceptance when nothing is accepted', () => {
    const { result } = renderHook(() => useDisclosureGate('app_wide'));
    expect(result.current.state).toBe('needs-acceptance');
  });

  it('returns ready when the accepted version matches the current version', () => {
    seedAccepted({ app_wide: DISCLOSURES.app_wide.version });
    const { result } = renderHook(() => useDisclosureGate('app_wide'));
    expect(result.current.state).toBe('ready');
  });

  it('returns needs-acceptance when the accepted version is stale', () => {
    seedAccepted({ app_wide: '1.0' }); // current is newer
    const { result } = renderHook(() => useDisclosureGate('app_wide'));
    expect(result.current.state).toBe('needs-acceptance');
  });

  it('reads the per-id version (roadmap) independently of app_wide', () => {
    seedAccepted({ app_wide: DISCLOSURES.app_wide.version });
    const { result } = renderHook(() => useDisclosureGate('roadmap'));
    expect(result.current.state).toBe('needs-acceptance');
  });

  it('app_wide, roadmap, and learning gates are independent', () => {
    seedAccepted({
      app_wide: DISCLOSURES.app_wide.version,
      roadmap: DISCLOSURES.roadmap.version,
      // learning intentionally unaccepted
    });
    expect(renderHook(() => useDisclosureGate('app_wide')).result.current.state).toBe('ready');
    expect(renderHook(() => useDisclosureGate('roadmap')).result.current.state).toBe('ready');
    expect(renderHook(() => useDisclosureGate('learning')).result.current.state).toBe('needs-acceptance');
  });

  it('surfaces the document on needs-acceptance', () => {
    const { result } = renderHook(() => useDisclosureGate('learning'));
    if (result.current.state !== 'needs-acceptance') throw new Error('expected needs-acceptance');
    expect(result.current.document.id).toBe('learning');
    expect(result.current.document.version).toBe(DISCLOSURES.learning.version);
  });
});

describe('normalized gate serves multiple disclosure ids from one table (MF-1)', () => {
  // Proves the promise: app_wide + roadmap + learning all resolve from the
  // single disclosure_acceptances table via one acceptances-store load — no
  // per-id column. (A second non-app_wide id stands in for the future
  // `backtest` id, which will register with zero gate edits.)
  it('one store load resolves every accepted id; an unaccepted id stays gated', async () => {
    const db = new SqliteAdapter(':memory:');
    const sql = (n: string) =>
      readFileSync(resolve(__dirname, `../../src/db/migrations/${n}.sql`), 'utf-8');
    await runMigrations(db, [
      { version: '0001_initial', sql: sql('0001_initial') },
      { version: '0017_disclosure_foundations', sql: sql('0017_disclosure_foundations') },
      { version: '0037_learning_state', sql: sql('0037_learning_state') },
    ]);
    setDatabase(db);

    const repo = new DisclosureAcceptancesRepo(db);
    await repo.record({ householdId: 1, documentId: 'app_wide', version: DISCLOSURES.app_wide.version, acceptedAt: '2026-01-01T00:00:00Z' });
    await repo.record({ householdId: 1, documentId: 'roadmap', version: DISCLOSURES.roadmap.version, acceptedAt: '2026-02-01T00:00:00Z' });
    // learning intentionally NOT accepted

    useAcceptancesStore.setState({ acceptedVersions: {}, status: 'ready', isLoading: false, error: null });
    await useAcceptancesStore.getState().load();

    expect(renderHook(() => useDisclosureGate('app_wide')).result.current.state).toBe('ready');
    expect(renderHook(() => useDisclosureGate('roadmap')).result.current.state).toBe('ready');
    expect(renderHook(() => useDisclosureGate('learning')).result.current.state).toBe('needs-acceptance');

    await db.close();
  });
});
