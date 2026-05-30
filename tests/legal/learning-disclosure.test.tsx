import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { DISCLOSURES } from '@/legal/disclosures';
import type { DisclosureDocument } from '@/legal/disclosures';
import { DisclosureModal } from '@/legal/DisclosureModal';
import { DisclosureAcceptancesRepo } from '@/domain/disclosure-acceptances';
import { useHouseholdStore } from '@/stores/household-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';

const loadInitial = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadDisclosure = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0017_disclosure_foundations.sql'), 'utf-8');
const loadLearning = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0037_learning_state.sql'), 'utf-8');

describe('learning disclosure (table-driven gate, MF-1)', () => {
  it('is registered with version 1.0', () => {
    expect(DISCLOSURES.learning).toBeDefined();
    expect(DISCLOSURES.learning.version).toBe('1.0');
    expect(DISCLOSURES.learning.body.length).toBeGreaterThan(50);
  });

  describe('persistence via disclosure_acceptances', () => {
    let db: SqliteAdapter;
    beforeEach(async () => {
      db = new SqliteAdapter(':memory:');
      await runMigrations(db, [
        { version: '0001_initial', sql: loadInitial() },
        { version: '0017_disclosure_foundations', sql: loadDisclosure() },
        { version: '0037_learning_state', sql: loadLearning() },
      ]);
      setDatabase(db);
      useHouseholdStore.setState({ household: null, isLoading: false, error: null });
      useAcceptancesStore.setState({ acceptedVersions: {}, status: 'ready', isLoading: false, error: null });
    });
    afterEach(async () => {
      await db.close();
    });

    it('accept writes the audit row AND refreshes the acceptances store', async () => {
      await useHouseholdStore.getState().load();
      await useHouseholdStore.getState().acceptDisclaimer('learning', '1.0');

      // Audit row exists (source of truth).
      const audit = await db.select<{ document_id: string; version: string }>(
        "SELECT document_id, version FROM disclosure_acceptances WHERE document_id = 'learning'",
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].version).toBe('1.0');

      // Store cache reflects it (the gate reads this — no household column).
      expect(useAcceptancesStore.getState().acceptedVersions.learning).toBe('1.0');
    });

    it('latestVersionsByDocument returns the latest per id', async () => {
      const repo = new DisclosureAcceptancesRepo(db);
      await repo.record({ householdId: 1, documentId: 'app_wide', version: '1.5', acceptedAt: '2026-01-01T00:00:00Z' });
      await repo.record({ householdId: 1, documentId: 'learning', version: '1.0', acceptedAt: '2026-05-28T00:00:00Z' });
      const map = await repo.latestVersionsByDocument();
      expect(map.app_wide).toBe('1.5');
      expect(map.learning).toBe('1.0');
    });

    it('reset (clearForHousehold) empties the table and the store cache', async () => {
      await useHouseholdStore.getState().load();
      await useHouseholdStore.getState().acceptDisclaimer('learning', '1.0');
      expect(useAcceptancesStore.getState().acceptedVersions.learning).toBe('1.0');

      await new DisclosureAcceptancesRepo(db).clearForHousehold(1);
      await useAcceptancesStore.getState().load();
      expect(useAcceptancesStore.getState().acceptedVersions.learning).toBeUndefined();
    });
  });
});

describe('DisclosureModal title totality (W3 / TR-5)', () => {
  it('renders a sane title for a synthetic new disclosure id with no modal edit (W3)', () => {
    // Stand-in for the future `backtest` id: a DisclosureDocument the modal has
    // never heard of. It must compile (the modal is total over DisclosureId via
    // the carried `title`) and render that title — no titleById map to update.
    const synthetic = {
      id: 'backtest',
      version: '1.0',
      title: 'About Backtesting',
      body: 'Synthetic body for the totality test.',
      acceptanceCheckboxLabel: 'I understand.',
    } as unknown as DisclosureDocument & { id: 'app_wide' };
    render(<DisclosureModal document={synthetic} continueLabel="Continue" onAccept={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('About Backtesting')).toBeInTheDocument();
  });

  // The synthetic case above casts an object that HAS a title, so it can only
  // prove the modal renders a carried title — it cannot catch a REAL DISCLOSURES
  // entry that OMITS title (e.g. the backtest plan registering its id without
  // one). This guard makes that cross-plan contract red at MERGE, not at runtime:
  // every registered disclosure must carry a non-empty title (the modal's
  // totality depends on it; the `?? 'Disclaimer'` fallback is a safety net, not a
  // license to omit).
  it('every registered DISCLOSURES entry carries a non-empty title (TR-5 totality contract)', () => {
    Object.values(DISCLOSURES).forEach((d) => expect(d.title).toBeTruthy());
  });
});
