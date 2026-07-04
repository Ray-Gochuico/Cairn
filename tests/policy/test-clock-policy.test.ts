import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, stripComments } from './source-walker';

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
// Frozen 2026-07 (Wave 5): the existing offenders below are grandfathered
// (regenerated at wave-5 HEAD: the 18 planning-time files plus the two
// Wave-2 store tests that mirror their store's own new Date() snapshot
// write). Shrink this list opportunistically; never grow it without a
// comment in the PR explaining why a real clock is genuinely required.
// ---------------------------------------------------------------------------
const REAL_CLOCK_ALLOWLIST: ReadonlySet<string> = new Set([
  'tests/components/Budget.test.tsx',
  'tests/components/Dashboard.test.tsx',
  'tests/components/Goals.test.tsx',
  'tests/components/Investments.test.tsx',
  'tests/components/MonthlyMiniWindow.test.tsx',
  'tests/components/Spending.test.tsx',
  'tests/components/levers/ExpensePeriodsPopover.test.tsx',
  'tests/components/levers/IncomePopover.test.tsx',
  'tests/components/levers/InflationPopover.test.tsx',
  'tests/db/init.test.ts',
  'tests/dev/seed-demo-data.test.ts',
  'tests/domain/fund-holdings.test.ts',
  'tests/lib/backup-restore.test.ts',
  'tests/lib/loan-history.test.ts',
  'tests/market/price-cache.test.ts',
  'tests/pdf/layout.test.ts',
  'tests/stores/learning-state-store.test.ts',
  'tests/stores/properties-store.test.ts',
  'tests/stores/vehicles-store.test.ts',
  'tests/types/schema.test.ts',
]);

// Built with the RegExp constructor so this file's own source never contains
// the literal patterns it hunts (a self-match would allowlist this file).
const REAL_CLOCK_RE = new RegExp('\\bnew Date\\(\\)|\\bDate\\.now\\(\\)');
const FAKE_TIMER_RE = new RegExp('useFakeTimers|setSystemTime');

describe('test real-clock policy', () => {
  it('test files reading the real clock without fake timers ⊆ frozen allowlist', async () => {
    const files = await collectSourceFiles(TESTS_DIR, ['.test.ts', '.test.tsx']);
    const offenders: string[] = [];
    for (const file of files) {
      const stripped = stripComments(readFileSync(file, 'utf8'));
      if (!REAL_CLOCK_RE.test(stripped)) continue;
      if (FAKE_TIMER_RE.test(stripped)) continue;
      offenders.push(path.relative(ROOT, file).split(path.sep).join('/'));
    }
    const fresh = offenders.filter((f) => !REAL_CLOCK_ALLOWLIST.has(f));
    if (fresh.length > 0) {
      throw new Error(
        [
          '',
          `New real-clock test file(s): ${fresh.join(', ')}`,
          '',
          'Inject the date (todayISO param / fixture date) or add vi.useFakeTimers()',
          '+ vi.setSystemTime(...). If a real clock is genuinely required, extend',
          'REAL_CLOCK_ALLOWLIST in tests/policy/test-clock-policy.test.ts in the',
          'same PR with a justification comment.',
          '',
        ].join('\n'),
      );
    }
    expect(fresh).toEqual([]);
  });

  it('allowlist hygiene: entries that no longer offend must be pruned', async () => {
    const files = await collectSourceFiles(TESTS_DIR, ['.test.ts', '.test.tsx']);
    const offenders = new Set<string>();
    for (const file of files) {
      const stripped = stripComments(readFileSync(file, 'utf8'));
      if (REAL_CLOCK_RE.test(stripped) && !FAKE_TIMER_RE.test(stripped)) {
        offenders.add(path.relative(ROOT, file).split(path.sep).join('/'));
      }
    }
    const stale = [...REAL_CLOCK_ALLOWLIST].filter((f) => !offenders.has(f));
    expect(stale).toEqual([]); // fixed a file? shrink the ratchet in the same PR
  });
});
