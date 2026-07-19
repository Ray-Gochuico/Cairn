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
  CALCULATOR_CARD_DEFS,
  CALCULATOR_CARD_GROUPS,
  CALCULATOR_CARD_IDS,
  calculatorCardLabel,
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

  it('LEGACY_ID_MIGRATIONS ids fall out at the intersection (Wave-18 D2: dead path, default-visible)', async () => {
    // Pre-Wave-18 this import mapped fire→financial-independence and
    // commission→commission-tax into hidden entries. Those ids merged into
    // supplemental-pay / path-to-fi (Wave 18 B6); D2 deliberately leaves this
    // extinct pre-DB path untouched — its now-unknown ids drop at the
    // CALCULATOR_CARD_IDS intersection, and default-visible is the safe
    // failure for a dead path.
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['fire', 'commission']));

    await importCalcVisibilityIfNeeded();

    const layout = (await new SettingsRepo(db).get()).calculatorCardLayout ?? [];
    const hidden = new Set(layout.filter((e) => e.hidden).map((e) => e.id));
    expect(hidden).toEqual(new Set());
    // The write still lands complete over the LIVE id list (never re-imports).
    expect(layout).toHaveLength(CALCULATOR_CARD_IDS.length);
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

describe('Wave-18 merged-card id fold (D2)', () => {
  const IDS = ['supplemental-pay', 'path-to-fi', 'debt-payoff'];
  it('legacy pair BOTH hidden → successor hidden (AND rule)', () => {
    expect(
      applyCalculatorCardLayout(IDS, [
        { id: 'bonus-tax', hidden: true },
        { id: 'commission-tax', hidden: true },
      ]),
    ).toEqual(['supplemental-pay']);
  });
  it('legacy pair split (one hidden, one visible) → successor visible', () => {
    expect(
      applyCalculatorCardLayout(IDS, [
        { id: 'bonus-tax', hidden: true },
        { id: 'commission-tax', hidden: false },
      ]),
    ).toEqual([]);
  });
  it('single legacy entry hidden (other absent) → successor hidden', () => {
    // Absent = the user never toggled it post-dating that entry's write; the
    // one signal we have says hidden.
    expect(
      applyCalculatorCardLayout(IDS, [{ id: 'coast-fi', hidden: true }]),
    ).toEqual(['path-to-fi']);
  });
  it('an explicit NEW-id entry always wins over the legacy fold', () => {
    expect(
      applyCalculatorCardLayout(IDS, [
        { id: 'bonus-tax', hidden: true },
        { id: 'commission-tax', hidden: true },
        { id: 'supplemental-pay', hidden: false },
      ]),
    ).toEqual([]);
  });
});

describe('CALCULATOR_CARD_DEFS (Wave-17 registry data)', () => {
  it('CALCULATOR_CARD_IDS derives from the defs (single source, grouped order)', () => {
    expect(CALCULATOR_CARD_IDS).toEqual(CALCULATOR_CARD_DEFS.map((d) => d.id));
    // Wave 18 B6: bonus-tax + commission-tax → supplemental-pay;
    // financial-independence + coast-fi → path-to-fi (registry section order).
    expect(CALCULATOR_CARD_IDS).toEqual([
      'paycheck', 'supplemental-pay', 'overtime', 'retirement-401k-withdrawal',
      'path-to-fi', 'compound-interest', 'backtest',
      'debt-payoff', 'equity', 'contribution-allocator',
    ]);
  });
  it('defs are contiguous by group, in CALCULATOR_CARD_GROUPS order', () => {
    const groupSeq = CALCULATOR_CARD_DEFS.map((d) => d.group);
    const firstIndex = new Map<string, number>();
    groupSeq.forEach((g, i) => { if (!firstIndex.has(g)) firstIndex.set(g, i); });
    expect([...firstIndex.keys()]).toEqual(CALCULATOR_CARD_GROUPS.map((g) => g.id));
    // Contiguous: sorting by first appearance must not change the sequence.
    expect(groupSeq).toEqual([...groupSeq].sort((a, b) => firstIndex.get(a)! - firstIndex.get(b)!));
  });
  it('labels survive the move (the old CARD_LABELS strings, byte-identical)', () => {
    expect(calculatorCardLabel('retirement-401k-withdrawal')).toBe('401k withdrawal take-home');
    // Wave 18 B6: merged-card labels.
    expect(calculatorCardLabel('supplemental-pay')).toBe('Supplemental pay');
    expect(calculatorCardLabel('path-to-fi')).toBe('Path to FI');
    expect(calculatorCardLabel('unknown-id')).toBe('unknown-id');
  });
  it('fullPagePath only on the two full-page tools', () => {
    const withPath = CALCULATOR_CARD_DEFS.filter((d) => d.fullPagePath);
    expect(withPath.map((d) => [d.id, d.fullPagePath])).toEqual([
      ['paycheck', '/calculators/paycheck'],
      ['backtest', '/calculators/backtest'],
    ]);
  });
});
