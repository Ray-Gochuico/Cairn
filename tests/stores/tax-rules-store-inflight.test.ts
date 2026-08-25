/**
 * Keyed in-flight de-dupe (Wave A item 4b, D-WA7): concurrent loadYear calls
 * for the SAME year must collapse to one DB query; DIFFERENT years must not
 * collapse (the reason this store is a documented createDedupedLoad
 * non-user); the in-flight entry clears after settle.
 * Pattern: tests/stores/vehicles-store-inflight.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { TaxRulesRepo } from '@/domain/tax-rules';

describe('useTaxRulesStore per-year in-flight de-dupe', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useTaxRulesStore.setState({ year: null, items: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('two concurrent loadYear(2026) calls hit listForYear only once', async () => {
    const spy = vi.spyOn(TaxRulesRepo.prototype, 'listForYear');
    const p1 = useTaxRulesStore.getState().loadYear(2026);
    const p2 = useTaxRulesStore.getState().loadYear(2026);
    await Promise.all([p1, p2]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('concurrent loads for DIFFERENT years are NOT collapsed', async () => {
    const spy = vi.spyOn(TaxRulesRepo.prototype, 'listForYear');
    await Promise.all([
      useTaxRulesStore.getState().loadYear(2025),
      useTaxRulesStore.getState().loadYear(2026),
    ]);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('the in-flight entry clears after settle — a later loadYear for an uncached year re-fetches', async () => {
    const spy = vi.spyOn(TaxRulesRepo.prototype, 'listForYear').mockResolvedValue([]);
    await useTaxRulesStore.getState().loadYear(2031); // items stay [] → result cache won't stick
    await useTaxRulesStore.getState().loadYear(2031);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
