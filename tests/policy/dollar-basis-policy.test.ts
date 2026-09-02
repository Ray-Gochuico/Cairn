import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, stripComments } from './source-walker';

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(ROOT, 'src');
const TESTS_DIR = path.join(ROOT, 'tests');

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

/* ── 1) Converter-import ratchet (D-T5 guarantee 2) ──────────────────────── */

// Bare-identifier matching (P12): subsumes alias imports, relative imports,
// and multi-line import blocks. Longer alternative first.
const CONVERTER_RE =
  /\b(toRealSummary|toRealSeries|toRealValue|realRateOfUnfloored|realRateOf)\b/;

/** The modules that DEFINE the converters (inherently allowed). */
const DEFINING_MODULES: ReadonlySet<string> = new Set([
  'src/lib/compound-interest.ts',
  'src/lib/calculators/real-mode.ts',
  'src/lib/calculators/real-rate.ts',
]);

/**
 * FROZEN, SHRINK-ONLY (W5 D-T5): adding ANY path here is a design-review
 * event, not a code change. coast-fi.ts is deliberately absent — it imports
 * nothing (callers pass pre-computed rates).
 *
 * Honest limit (spec § Architecture guarantee 2): a grep ratchet cannot catch
 * RE-DERIVED inline Fisher arithmetic (`college-tradeoff.ts` computes it
 * inline, legitimately). That residue is what the historical anchors and the
 * basis-audit render sweep exist for.
 */
const CONVERTER_ALLOWLIST: ReadonlySet<string> = new Set([
  // THE conversion boundary — the only display-layer entry.
  'src/lib/calculators/basis-view.ts',
  // Engine modules that consume converters (D-T10, signatures untouched).
  'src/lib/calculators/projection-chart.ts',
  'src/lib/financial-independence.ts',
  // Real-only by plan law (interview CI-33; anchor $13,538 / anti $18,194).
  'src/lib/interview/effects.ts',
  // LEGACY: What-If's private basis. W5.1 migrates What-If and DELETES this
  // entry (the shrink-only rule) — see the W5.1 chip.
  'src/components/whatif/FiCards.tsx',
  // LEGACY (2026-09-01, coordinator ruling A): W1 landed before this ratchet;
  // uses realRateOfUnfloored for rate arithmetic only (no $ converter);
  // migrate onto the basis boundary then shrink by one — chip.
  'src/pages/calculators/StressTestCard.tsx',
  // LEGACY (2026-09-01, coordinator ruling A): W1 landed before this ratchet;
  // uses realRateOfUnfloored for rate arithmetic only (no $ converter);
  // migrate onto the basis boundary then shrink by one — chip.
  'src/pages/calculators/EarliestRetirementCard.tsx',
]);

async function converterOffenders(): Promise<string[]> {
  const files = await collectSourceFiles(SRC_DIR);
  const out: string[] = [];
  for (const file of files) {
    const r = rel(file);
    if (DEFINING_MODULES.has(r)) continue;
    if (CONVERTER_RE.test(stripComments(readFileSync(file, 'utf8')))) out.push(r);
  }
  return out;
}

describe('dollar-basis policy — converter imports are boundary-only', () => {
  it('converter-touching src files ⊆ the frozen allowlist', async () => {
    const fresh = (await converterOffenders()).filter((f) => !CONVERTER_ALLOWLIST.has(f));
    if (fresh.length > 0) {
      throw new Error(
        [
          '',
          `New converter consumer(s) outside the boundary: ${fresh.join(', ')}`,
          '',
          'Raw conversion (toRealSummary/toRealSeries/toRealValue/realRateOf*)',
          'may only happen inside src/lib/calculators/basis-view.ts (the ONE',
          'conversion boundary) or the pinned engine modules. Route the figure',
          'through a BasisView bundle instead. Extending CONVERTER_ALLOWLIST is',
          'a breaking-change review (W5 spec, frozen contract) — never a drive-by.',
          '',
        ].join('\n'),
      );
    }
    expect(fresh).toEqual([]);
  });

  it('allowlist hygiene: entries that no longer touch converters must be pruned (shrink-only)', async () => {
    const offenders = new Set(await converterOffenders());
    const stale = [...CONVERTER_ALLOWLIST].filter((f) => !offenders.has(f));
    expect(
      stale,
      'prune these from CONVERTER_ALLOWLIST in the same PR (W5.1 prunes FiCards.tsx)',
    ).toEqual([]);
  });
});

/* ── 2) Basis store: one key, three readers (D-T5 guarantee 1) ───────────── */

const BASIS_KEY_RE = /calc-basis:/;
const STORE_RE = /\buseDollarBasis(Store)?\b|\b__resetDollarBasisForTests\b/;
const KEY_ALLOWLIST: ReadonlySet<string> = new Set(['src/lib/calculators/dollar-basis.ts']);
const STORE_ALLOWLIST: ReadonlySet<string> = new Set([
  'src/lib/calculators/dollar-basis.ts',
  'src/lib/calculators/basis-view.ts',
  'src/components/calculators/DollarBasisToggle.tsx',
]);

describe('dollar-basis policy — one store, pinned readers', () => {
  it('only dollar-basis.ts touches the calc-basis: storage key', async () => {
    const files = await collectSourceFiles(SRC_DIR);
    const offenders = files
      .filter((f) => BASIS_KEY_RE.test(stripComments(readFileSync(f, 'utf8'))))
      .map(rel)
      .filter((f) => !KEY_ALLOWLIST.has(f));
    expect(offenders, 'the storage key is private to the store (D-T2)').toEqual([]);
  });

  it('only the store/boundary/toggle read basis state in src/', async () => {
    const files = await collectSourceFiles(SRC_DIR);
    const offenders = files
      .filter((f) => STORE_RE.test(stripComments(readFileSync(f, 'utf8'))))
      .map(rel)
      .filter((f) => !STORE_ALLOWLIST.has(f));
    expect(offenders, 'components receive BasisView bundles, never the raw basis (D-T5)').toEqual(
      [],
    );
  });
});

/* ── 3) Grep-zero: the old per-card mechanism is DEAD (D-T9) ─────────────── */

// Split-concat so this file never matches its own hunt patterns.
const DOOMED_RE = new RegExp(
  ['useChart' + 'DisplayMode', 'RealNominal' + 'Toggle', 'calc-display' + '-mode'].join('|'),
);

describe('dollar-basis policy — the per-card toggle stays dead', () => {
  it('zero references in src/ and tests/ (stripped of comments)', async () => {
    const files = [
      ...(await collectSourceFiles(SRC_DIR)),
      ...(await collectSourceFiles(TESTS_DIR)),
    ];
    const offenders: string[] = [];
    for (const file of files) {
      if (rel(file) === 'tests/policy/dollar-basis-policy.test.ts') continue; // self
      if (DOOMED_RE.test(stripComments(readFileSync(file, 'utf8')))) offenders.push(rel(file));
    }
    expect(
      offenders,
      'useChartDisplayMode/RealNominalToggle/calc-display-mode were deleted in W5',
    ).toEqual([]);
  });
});

/* ── 4) Detector self-tests (an untested detector is a bypass) ───────────── */

describe('dollar-basis policy — detector self-tests', () => {
  it('CONVERTER_RE catches alias, relative, multi-line, and bare-call forms', () => {
    expect(CONVERTER_RE.test("import { realRateOfUnfloored } from './calculators/real-rate';")).toBe(
      true,
    );
    expect(
      CONVERTER_RE.test(
        "import {\n  compoundInterestSeries,\n  toRealSummary,\n} from '@/lib/compound-interest';",
      ),
    ).toBe(true);
    expect(CONVERTER_RE.test('const y = realRateOf(0.07, 0.03);')).toBe(true);
    expect(CONVERTER_RE.test('const surrealRateOfChange = 1;')).toBe(false);
    expect(CONVERTER_RE.test('const toRealSummaryX = 1;')).toBe(false);
  });
});
