import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, uncoveredClockReads } from './source-walker';

const ROOT = path.resolve(__dirname, '..', '..');
const TESTS_DIR = path.join(ROOT, 'tests');

// ---------------------------------------------------------------------------
// P3 ratchet: no NEW real-clock tests.
//
// A test that reads the wall clock without fake timers is a time bomb: it
// passes today and fails when the calendar rolls past a fixture boundary
// (the loan-history WEEK-bucket bug class). New tests must either pass an
// explicit date/`todayISO` into the code under test, or set up
// `vi.useFakeTimers()` / `vi.setSystemTime(...)`.
//
// v1.8.0 W4 (C174): the rule is per block, not per file. A no-argument
// `new Date()` or `Date.now()` is a real-clock read unless the block it runs
// in has the fake clock: its own test or hook installs it, or a
// beforeEach/beforeAll in its describe chain does (source-walker.ts
// `uncoveredClockReads` states the whole rule). Shared helpers are scanned
// too: every .ts/.tsx under tests/, not only *.test.* files. A bare
// localTodayISO() is deliberately NOT a read here: DebtPayoffCard.test.tsx
// and tests/helpers/roadmap-local-day-reads.ts use it as a same-clock oracle.
//
// Frozen 2026-07 (Wave 5): the existing offenders below are grandfathered
// (regenerated at wave-5 HEAD: the 18 planning-time files plus the two
// Wave-2 store tests that mirror their store's own new Date() snapshot
// write). Shrink this list opportunistically; never grow it without a
// comment in the PR explaining why a real clock is genuinely required.
// ---------------------------------------------------------------------------
const REAL_CLOCK_ALLOWLIST: ReadonlySet<string> = new Set([
  // Budget.test.tsx pruned 2026-11 (v1.8.0 W4, C174 (d)): its fixture months are
  // one literal month and the page runs on a literal local day.
  // Dashboard.test.tsx was pruned from this allowlist 2026-07-09 (W13). Its
  // person-view and MoM-pill describes read the clock outside the faked
  // blocks until 2026-11 (v1.8.0 W4, C174 (a)), when both took a literal day.
  // Goals.test.tsx pruned 2026-09 (v1.8.0 A-2′): its local-day describe pins the
  // clock via vi.useFakeTimers({ toFake: ['Date'] }). Its monthlyContribs helper
  // counts back from a literal day since 2026-11 (v1.8.0 W4, C174 (d)).
  'tests/components/Investments.test.tsx',
  'tests/components/MonthlyMiniWindow.test.tsx',
  'tests/components/Spending.test.tsx',
  // ExpensePeriodsPopover.test.tsx pruned 2026-09 (R1): its count-label describe
  // pins the clock via vi.useFakeTimers({ toFake: ['Date'] }). Re-listed 2026-11
  // (v1.8.0 W4, C174 (a)): the per-block rule sees its module-scope
  // `const today = new Date()` (:45), read at collection before any hook. The
  // file belongs to lane W4-L3 this wave (the three W4 lanes share no file), so
  // the read is not edited here; prune this entry when that read goes.
  'tests/components/levers/ExpensePeriodsPopover.test.tsx',
  'tests/components/levers/IncomePopover.test.tsx',
  'tests/components/levers/InflationPopover.test.tsx',
  'tests/db/init.test.ts',
  // The sample-profile seed suite (now tests/domain/sample-profile/
  // sample-profile.test.ts; W4 moved it out of tests/dev/) was pruned from
  // this allowlist 2026-07-29 (Wave A T2): its local-vs-UTC today-snapshot pin
  // uses vi.useFakeTimers + setSystemTime, which the detector counts as
  // fake-timer usage.
  'tests/domain/fund-holdings.test.ts',
  // loan-history.test.ts pruned 2026-09 (v1.8.0 A-2′): its default-anchor describe
  // uses fake timers; its five legacy tests and the pin-4 test run on a literal
  // local day since 2026-11 (v1.8.0 W4, C174 (d)).
  // price-cache.test.ts pruned 2026-09 (v1.8.0 A-2′): its local-key describe uses
  // fake timers; its TTL tests key on a literal local day since 2026-11 (v1.8.0
  // W4, C174 (d)), with SQLite's own 'now' on both sides of the 6-hour check.
  'tests/pdf/layout.test.ts',
  'tests/stores/properties-store.test.ts',
  'tests/stores/vehicles-store.test.ts',
  'tests/types/schema.test.ts',
]);

function rel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

/** Every .ts/.tsx under tests/ (test files AND their helpers), relative to the repo root. */
async function scannedFiles(): Promise<string[]> {
  return (await collectSourceFiles(TESTS_DIR, ['.ts', '.tsx'])).map(rel).sort();
}

async function offenders(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const file of await scannedFiles()) {
    const reads = uncoveredClockReads(readFileSync(path.join(ROOT, file), 'utf8'), file);
    if (reads.length > 0) out.set(file, reads.map((r) => `${file}:${r.line} ${r.text}`));
  }
  return out;
}

// One scan of the tree per file run, shared by the two tests below (v1.8.0 W4
// review): each test scanned on its own, and on a busy machine the pair ran
// past vitest's 10 s default. SCAN_TIMEOUT_MS is room for a loaded host, not a
// pin; every assertion is unchanged.
let scan: Promise<Map<string, string[]>> | undefined;
const scanOnce = (): Promise<Map<string, string[]>> => (scan ??= offenders());
const SCAN_TIMEOUT_MS = 60_000;

describe('test real-clock policy', () => {
  it('test files and helpers reading the real clock outside a faked block ⊆ frozen allowlist', async () => {
    const found = await scanOnce();
    const fresh = [...found.keys()].filter((f) => !REAL_CLOCK_ALLOWLIST.has(f));
    if (fresh.length > 0) {
      throw new Error(
        [
          '',
          'New real-clock read(s) outside a faked block:',
          ...fresh.flatMap((f) => found.get(f) ?? []),
          '',
          'Inject the date (todayISO param / fixture date) or give the block its own',
          'vi.useFakeTimers() + vi.setSystemTime(...) (in the test, or in a beforeEach of',
          'its describe chain). If a real clock is genuinely required, extend',
          'REAL_CLOCK_ALLOWLIST in tests/policy/test-clock-policy.test.ts in the',
          'same PR with a justification comment.',
          '',
        ].join('\n'),
      );
    }
    expect(fresh).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it('allowlist hygiene: entries that no longer offend must be pruned', async () => {
    const found = await scanOnce();
    const stale = [...REAL_CLOCK_ALLOWLIST].filter((f) => !found.has(f));
    expect(stale).toEqual([]); // fixed a file? shrink the ratchet in the same PR
  }, SCAN_TIMEOUT_MS);
});

// Planted-violation self-tests (C174): each fixture is a string handed to the
// detector, never a file in the tree.
const lines = (src: string, file = 'fixture.test.ts') => uncoveredClockReads(src, file).map((r) => r.line);

describe('the per-block real-clock detector (self-tests)', () => {
  it('flags a bare new Date() in a describe without a fake clock, beside a describe that has one', () => {
    const src = [
      "describe('A', () => {",
      '  beforeEach(() => { vi.useFakeTimers(); });',
      "  it('a', () => { const d = new Date(); });",
      '});',
      "describe('B', () => {",
      "  it('b', () => { const d = new Date(); });",
      '});',
    ].join('\n');
    expect(lines(src)).toEqual([6]);
  });

  it('a fake clock set by the test, a beforeAll up the chain, a module beforeEach or a same-file helper covers the read', () => {
    const inTest = "it('t', () => { vi.setSystemTime(new Date('2026-11-14T12:00:00')); const n = Date.now(); });";
    const upChain = [
      "describe('outer', () => {",
      '  beforeAll(() => { vi.useFakeTimers(); });',
      "  describe('inner', () => {",
      "    it('t', () => { const d = new Date(); });",
      '  });',
      '});',
    ].join('\n');
    const moduleHook = [
      'beforeEach(() => { vi.useFakeTimers(); });',
      'function stamp() { return new Date(); }',
      "it('t', () => { stamp(); });",
    ].join('\n');
    const helper = [
      "function pinDay() { vi.useFakeTimers({ toFake: ['Date'] }); }",
      "describe('h', () => {",
      '  beforeEach(pinDay);',
      "  it('t', () => { const d = new Date(); });",
      '});',
    ].join('\n');
    expect([lines(inTest), lines(upChain), lines(moduleHook), lines(helper)]).toEqual([[], [], [], []]);
  });

  it('flags a module-scope helper, and a read that runs at collection, even when a beforeEach fakes the clock', () => {
    const src = [
      'function monthAgo() { return new Date(); }',
      "describe('C', () => {",
      '  beforeEach(() => { vi.useFakeTimers(); });',
      '  const atCollection = new Date();',
      '  const iife = (() => Date.now())();',
      '  const later = () => Date.now();',
      "  it('c', () => { monthAgo(); later(); });",
      '});',
    ].join('\n');
    expect(lines(src)).toEqual([1, 4, 5]);
  });

  it('ignores clock text in strings, templates and comments, dated constructions, and localTodayISO()', () => {
    const src = [
      '// new Date() in a line comment',
      '/* Date.now() in a block comment */',
      "const s = 'new Date()';",
      "const t = `Date.now() ${'x'}`;",
      "const url = 'https://example.test//new Date()';",
      "const fixed = new Date('2026-11-14T12:00:00');",
      'const parts = new Date(2026, 10, 14);',
      'const day = localTodayISO();',
    ].join('\n');
    expect(lines(src)).toEqual([]);
  });

  it('flags Date.now() in a shared helper file, and the scan covers tests/helpers and other support files', async () => {
    const helperSrc = 'export function nowIso(): string { return new Date(Date.now()).toISOString(); }';
    expect(uncoveredClockReads(helperSrc, 'tests/helpers/clock.ts')).toEqual([{ line: 1, text: 'Date.now()' }]);
    const scanned = await scannedFiles();
    expect(scanned).toEqual(expect.arrayContaining([
      'tests/helpers/roadmap-local-day-reads.ts',
      'tests/factories.ts',
      'tests/policy/test-clock-policy.test.ts',
    ]));
  });
});
