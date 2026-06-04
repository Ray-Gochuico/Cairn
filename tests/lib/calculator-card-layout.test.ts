import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { SettingsRepo } from '@/domain/app-settings';
import type { CardLayoutEntry } from '@/types/schema';
import {
  applyCalculatorCardLayout,
  importCalcVisibilityIfNeeded,
  __resetImportLatchForTests,
  CALCULATOR_CARD_IDS,
} from '@/lib/calculator-card-layout';

const LEGACY_KEY = 'calculator-hidden-cards';

describe('applyCalculatorCardLayout', () => {
  const ids = ['a', 'b', 'c'];

  it('returns [] (nothing hidden) when layout is null', () => {
    expect(applyCalculatorCardLayout(ids, null)).toEqual([]);
  });

  it('returns the ids marked hidden in the layout', () => {
    const layout: CardLayoutEntry[] = [
      { id: 'a', hidden: true },
      { id: 'b', hidden: false },
      { id: 'c', hidden: true },
    ];
    expect(applyCalculatorCardLayout(ids, layout).sort()).toEqual(['a', 'c']);
  });

  it('ignores layout entries for unknown ids (defensive)', () => {
    const layout: CardLayoutEntry[] = [{ id: 'zzz', hidden: true }];
    expect(applyCalculatorCardLayout(ids, layout)).toEqual([]);
  });

  it('treats an id absent from a non-null layout as visible (newly-added card)', () => {
    const layout: CardLayoutEntry[] = [{ id: 'a', hidden: true }];
    // 'b' and 'c' are not in the layout → visible; only 'a' hidden.
    expect(applyCalculatorCardLayout(ids, layout)).toEqual(['a']);
  });
});

describe('importCalcVisibilityIfNeeded', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    localStorage.clear();
    __resetImportLatchForTests();
  });

  afterEach(async () => {
    await db.close();
  });

  it('imports the legacy localStorage value into the DB and clears the key', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['paycheck', 'backtest']));

    await importCalcVisibilityIfNeeded();

    const layout = (await new SettingsRepo(db).get()).calculatorCardLayout;
    expect(layout).not.toBeNull();
    // Every known card has an entry; the two imported ids are hidden.
    const hidden = new Set(
      (layout ?? []).filter((e) => e.hidden).map((e) => e.id),
    );
    expect(hidden).toEqual(new Set(['paycheck', 'backtest']));
    expect(layout).toHaveLength(CALCULATOR_CARD_IDS.length);
    // Key cleared on success.
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('applies LEGACY_ID_MIGRATIONS on import (fire->financial-independence, commission->commission-tax)', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['fire', 'commission']));

    await importCalcVisibilityIfNeeded();

    const layout = (await new SettingsRepo(db).get()).calculatorCardLayout ?? [];
    const hidden = new Set(layout.filter((e) => e.hidden).map((e) => e.id));
    expect(hidden).toEqual(new Set(['financial-independence', 'commission-tax']));
  });

  it('writes a non-null all-visible layout even when nothing was hidden (so it never re-imports)', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify([]));

    await importCalcVisibilityIfNeeded();

    const layout = (await new SettingsRepo(db).get()).calculatorCardLayout;
    expect(layout).not.toBeNull();
    expect((layout ?? []).every((e) => e.hidden === false)).toBe(true);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('is a no-op when the DB field is already non-null (idempotent second read)', async () => {
    const repo = new SettingsRepo(db);
    await repo.update({ calculatorCardLayout: [{ id: 'paycheck', hidden: true }] });
    // A stale localStorage value must NOT override the existing DB layout.
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['backtest']));
    __resetImportLatchForTests();

    await importCalcVisibilityIfNeeded();

    expect((await repo.get()).calculatorCardLayout).toEqual([
      { id: 'paycheck', hidden: true },
    ]);
    // No-op path must NOT touch the key.
    expect(localStorage.getItem(LEGACY_KEY)).toBe(JSON.stringify(['backtest']));
  });

  it('is a no-op (and leaves DB null) when there is no legacy key', async () => {
    await importCalcVisibilityIfNeeded();
    expect((await new SettingsRepo(db).get()).calculatorCardLayout).toBeNull();
  });

  it('tolerates malformed legacy JSON: treats it as no hidden cards, still writes all-visible, clears key', async () => {
    localStorage.setItem(LEGACY_KEY, '{not json}');

    await importCalcVisibilityIfNeeded();

    const layout = (await new SettingsRepo(db).get()).calculatorCardLayout;
    // getHiddenCards() returns [] on malformed → all-visible layout written.
    expect(layout).not.toBeNull();
    expect((layout ?? []).every((e) => e.hidden === false)).toBe(true);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('fires the DB write exactly once under concurrent calls (single-fire latch)', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['paycheck']));
    const execSpy = vi.spyOn(db, 'execute');

    await Promise.all([
      importCalcVisibilityIfNeeded(),
      importCalcVisibilityIfNeeded(),
      importCalcVisibilityIfNeeded(),
    ]);

    // Exactly one UPDATE app_settings ... calculator_card_layout write.
    const calcWrites = execSpy.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && /UPDATE app_settings/i.test(sql),
    );
    expect(calcWrites).toHaveLength(1);
  });

  it('fail-soft: on write error it leaves the key and resolves without throwing; a later call retries', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['paycheck']));
    // First call: force the write to throw.
    const execSpy = vi
      .spyOn(db, 'execute')
      .mockRejectedValueOnce(new Error('disk full'));

    await expect(importCalcVisibilityIfNeeded()).resolves.toBeUndefined();
    // Key preserved for retry; DB still null.
    expect(localStorage.getItem(LEGACY_KEY)).toBe(JSON.stringify(['paycheck']));

    // Restore real execute; the latch must have released so a retry works.
    execSpy.mockRestore();
    __resetImportLatchForTests();
    await importCalcVisibilityIfNeeded();
    const layout = (await new SettingsRepo(db).get()).calculatorCardLayout ?? [];
    expect(new Set(layout.filter((e) => e.hidden).map((e) => e.id))).toEqual(
      new Set(['paycheck']),
    );
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});
