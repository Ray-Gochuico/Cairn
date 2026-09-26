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
  /\b(toRealSummary|toRealSeries|toRealValue|realRateOfUnfloored|realRateOf|toReal)\b/;

/** The modules that DEFINE the converters (inherently allowed). */
const DEFINING_MODULES: ReadonlySet<string> = new Set([
  'src/lib/compound-interest.ts',
  'src/lib/calculators/real-mode.ts',
  'src/lib/calculators/real-rate.ts',
  // What-If's first-class deflator (`toReal`). Review fix (MINOR 3): it is a
  // basis converter like the other five, so the /calculators cards cannot be
  // allowed to reach around the boundary through it.
  'src/lib/scenarios/real.ts',
]);

/**
 * FROZEN, SHRINK-ONLY (W5 D-T5): adding ANY path here is a design-review
 * event, not a code change. coast-fi.ts is deliberately absent — it imports
 * nothing (callers pass pre-computed rates).
 *
 * Honest limit (spec § Architecture guarantee 2): a grep ratchet cannot catch
 * RE-DERIVED inline Fisher arithmetic (`college-tradeoff.ts` computes it
 * inline, legitimately; What-If's `ManageScenariosModal.tsx` deflates with an
 * inline `/ Math.pow(1 + inflation, 30)`). That residue is what the historical
 * anchors and the basis-audit render sweep exist for.
 */
const CONVERTER_ALLOWLIST: ReadonlySet<string> = new Set([
  // THE conversion boundary — the only display-layer entry.
  'src/lib/calculators/basis-view.ts',
  // Engine modules that consume converters (D-T10, signatures untouched).
  'src/lib/calculators/projection-chart.ts',
  'src/lib/financial-independence.ts',
  // Real-only by plan law (interview CI-33; anchor $13,538 / anti $18,194).
  'src/lib/interview/effects.ts',
]);

/**
 * SHRINK-ONLY BY MECHANISM (review fix, MINOR 2). The prose above says
 * "adding ANY path here is a design-review event"; this number makes an
 * offender-plus-entry drive-by fail CI instead of passing both halves.
 * shrink-only: LOWER this number when you prune; never raise it.
 */
// W5.1 Task 5: ProjectionChart + the scenarios barrel came off — 9 → 7.
// W5.1 Task 6: FiCards came off — 7 → 6. Remaining LEGACY: the two W1 cards (ruling A chip).
// B2 Task 5: StressTestCard onto the boundary (realRateView) — 6 → 5.
// B2 Task 6: EarliestRetirementCard onto the boundary — 5 → 4. No LEGACY entry remains.
const CONVERTER_ALLOWLIST_CEILING = 4;

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

/** The contracted converter names, as a set (CONVERTER_RE's alternation, exactly). */
const CONVERTER_NAMES: ReadonlySet<string> = new Set([
  'toRealSummary',
  'toRealSeries',
  'toRealValue',
  'realRateOfUnfloored',
  'realRateOf',
  'toReal',
]);

/** A module specifier that resolves to a DEFINING module (alias or relative; extension optional — .ts/.tsx/.js/.jsx). */
const DEFINING_SPECIFIER_RE = /(?:^|\/)(?:real-rate|real-mode|compound-interest|scenarios\/real)(?:\.[jt]sx?)?$/;

/**
 * v1.7.1 A-5a (1): the export shapes that pass a converter on under a name
 * CONVERTER_RE cannot see. Comments stripped. Six arms:
 *  (a) a value re-export FROM a defining module — `export { … } from '…/real-rate'`
 *      or `export * [as ns] from '…'` (type-only `export type { … }`, or a list
 *      whose every entry is an inline `type X`, carries no value);
 *  (b) a rename in any export list — `export { realRateOf as rateLeg }`;
 *  (c) a value alias — `export const rateLeg = realRateOf` (`;` optional);
 *  (d) a default export of a converter — `export default realRateOf` (`;` optional);
 *  (e) an IMPORT-side alias passed on — `import { realRateOf as rateLeg }` or
 *      `import * as rr from '…/real-rate'`, then `rateLeg` / `rr` in an export
 *      list, as (c)'s right-hand side, or as (d)'s default;
 *  (f) a LOCAL alias passed on the same way — `const y = realRateOf;` (or an
 *      alias of an alias), then `y` in an export list, (c) or (d).
 * In (c), (d) and (f) the annotation may be any type, a function type's `=>`
 * included, and the right-hand side may be parenthesized or `as` /
 * `satisfies`-cast (P5 review round). A call (`= realRateOf(…)`) is a computed
 * value, not an alias.
 * Not claimed: a converter handed on inside an object or through a member
 * read (`export const rates = { realRateOf }`, `export const leg = rr.realRateOf`).
 * A WRAPPER (`export function rateLeg(…) { return realRateOf(…); }`) is API
 * design, not an alias — the honest limit above covers it.
 */
/** An optional type annotation — `=>` allowed, so a function type does not end at its arrow. */
const ALIAS_ANNOTATION = String.raw`(?::(?:[^=;]|=>)+)?`;
/** An alias's right-hand side: a bare name, optionally parenthesized, optionally `as`/`satisfies`-cast, then `;` or the line's end. */
const ALIAS_RHS = String.raw`\(?\s*(\w+)\s*\)?(?:\s+(?:as|satisfies)\s+[^;\n]*)?[ \t]*(?:;|$)`;

function aliasedConverterExports(source: string): string[] {
  const s = stripComments(source);
  const hits: string[] = [];
  // (a)
  for (const m of s.matchAll(/export\s*(\{[^}]*\}|\*(?:\s*as\s+\w+)?)\s*from\s*(['"])([^'"]*)\2/g)) {
    const list = m[1].startsWith('{') ? m[1].slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean) : [];
    if (list.length > 0 && list.every((x) => /^type\s/.test(x))) continue; // inline type-only: no value
    if (DEFINING_SPECIFIER_RE.test(m[3])) hits.push(m[0].replace(/\s+/g, ' '));
  }
  // (b)
  for (const m of s.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const spec of m[1].split(',')) {
      const named = spec.trim().match(/^(?:type\s+)?(\w+)\s+as\s+(\w+)$/);
      if (named && CONVERTER_NAMES.has(named[1]) && named[1] !== named[2]) hits.push(`${named[1]} as ${named[2]}`);
    }
  }
  // (e) the import-side aliases this file could pass on
  const importAliases = new Set<string>();
  for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const spec of m[1].split(',')) {
      const named = spec.trim().match(/^(?:type\s+)?(\w+)\s+as\s+(\w+)$/);
      if (named && CONVERTER_NAMES.has(named[1]) && named[1] !== named[2]) importAliases.add(named[2]);
    }
  }
  for (const m of s.matchAll(/import\s*\*\s*as\s+(\w+)\s*from\s*(['"])([^'"]*)\2/g)) {
    if (DEFINING_SPECIFIER_RE.test(m[3])) importAliases.add(m[1]);
  }
  // (f) the local aliases — ONE pass in source order: an alias of an alias is
  //     declared after the alias it reads, so the chain is already in the set
  const localAliases = new Set<string>();
  const passedOn = (name: string) =>
    CONVERTER_NAMES.has(name) || importAliases.has(name) || localAliases.has(name);
  const localAliasRe = new RegExp(String.raw`\b(?:const|let|var)\s+(\w+)\s*` + ALIAS_ANNOTATION + String.raw`=\s*` + ALIAS_RHS, 'gm');
  for (const m of s.matchAll(localAliasRe)) {
    if (passedOn(m[2]) && m[1] !== m[2]) localAliases.add(m[1]);
  }
  for (const m of s.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const spec of m[1].split(',')) {
      const local = spec.trim().match(/^(\w+)(?:\s+as\s+\w+)?$/);
      if (local && importAliases.has(local[1])) hits.push(`${local[1]} (an import alias) exported`);
      else if (local && localAliases.has(local[1])) hits.push(`${local[1]} (a local alias) exported`);
    }
  }
  // (c)
  for (const m of s.matchAll(new RegExp(String.raw`export\s+(?:const|let|var)\s+(\w+)\s*` + ALIAS_ANNOTATION + String.raw`=\s*` + ALIAS_RHS, 'gm'))) {
    if (passedOn(m[2]) && m[1] !== m[2]) hits.push(`${m[1]} = ${m[2]}`);
  }
  // (d)
  for (const m of s.matchAll(new RegExp(String.raw`export\s+default\s+` + ALIAS_RHS, 'gm'))) {
    if (passedOn(m[1])) hits.push(`default ${m[1]}`);
  }
  return hits;
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

  it('the allowlist never GROWS: its size is pinned at the ceiling (shrink-only, by mechanism)', () => {
    expect(
      CONVERTER_ALLOWLIST.size,
      'a new converter consumer may not be waved through by appending itself here — ' +
        'route it through the BasisView boundary, or hold a design review and lower ' +
        'CONVERTER_ALLOWLIST_CEILING when you prune',
    ).toBe(CONVERTER_ALLOWLIST_CEILING);
  });

  // v1.7.1 A-5a (1), B2 review MINOR 4: CONVERTER_RE reads bare names, so an
  // allowlisted or defining module that re-exports a converter under ANOTHER
  // name hands it to a consumer the ratchet never sees (mutant M5: basis-view
  // re-exporting realRateOfUnfloored as rateLeg left this file green).
  it('no allowlisted or defining module re-exports a converter (or renames one on export)', () => {
    const hits = [...CONVERTER_ALLOWLIST, ...DEFINING_MODULES].flatMap((m) =>
      aliasedConverterExports(readFileSync(path.join(ROOT, m), 'utf8')).map((h) => `${m}: ${h}`),
    );
    expect(
      hits,
      'import the converter where it is used (the ratchet then sees it), or route the figure ' +
        'through a BasisView bundle; a renamed converter is the same converter',
    ).toEqual([]);
  });

  it('allowlist hygiene: entries that no longer touch converters must be pruned (shrink-only)', async () => {
    const offenders = new Set(await converterOffenders());
    const stale = [...CONVERTER_ALLOWLIST].filter((f) => !offenders.has(f));
    expect(
      stale,
      'prune these from CONVERTER_ALLOWLIST in the same PR (shrink-only)',
    ).toEqual([]);
  });
});

/* ── 2) Basis store: one key, three readers (D-T5 guarantee 1) ───────────── */

const BASIS_KEY_RE = /calc-basis:/;
const STORE_RE =
  /\buseDollarBasis(Store)?\b|\b__resetDollarBasisForTests\b|\b__readInitialDollarBasisForTests\b/;
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
  [
    'useChart' + 'DisplayMode',
    'RealNominal' + 'Toggle',
    'calc-display' + '-mode',
    // W5.1: What-If's private basis is dead too (src AND tests, stripped of comments).
    'dollar' + 'Mode',
    'Dollar' + 'Mode',
  ].join('|'),
);

describe("dollar-basis policy — the per-card toggle and What-If's private basis stay dead", () => {
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
      'useChartDisplayMode/RealNominalToggle/calc-display-mode were deleted in W5'
        + '; ' + 'dollar' + 'Mode' + '/' + 'Dollar' + 'Mode' + ' were deleted in W5.1',
    ).toEqual([]);
  });
});

/* ── 4) Detector self-tests (an untested detector is a bypass) ───────────── */

/**
 * The identifiers the ratchet CONTRACTS to catch. Kept as data (not prose) so
 * that dropping one from CONVERTER_RE, or adding a new basis converter to a
 * defining module without ratcheting it, is a red build rather than a silent
 * hole. Review fix: the shipped self-test exercised import FORMS only.
 */
const CONTRACT_CONVERTERS = [
  'toRealSummary',
  'toRealSeries',
  'toRealValue',
  'realRateOfUnfloored',
  'realRateOf',
  'toReal',
] as const;

/** Value exports of the defining modules whose NAME claims a basis conversion. */
function declaredConverters(): string[] {
  const names = new Set<string>();
  for (const m of DEFINING_MODULES) {
    const src = readFileSync(path.join(ROOT, m), 'utf8');
    for (const match of src.matchAll(/^export\s+(?:function|const)\s+(\w+)/gm)) {
      if (/real/i.test(match[1])) names.add(match[1]);
    }
  }
  return [...names].sort();
}

describe('dollar-basis policy — detector self-tests', () => {
  it('CONVERTER_RE catches EVERY contracted converter by name (import and bare call)', () => {
    for (const name of CONTRACT_CONVERTERS) {
      expect(
        CONVERTER_RE.test(`import { ${name} } from '@/lib/calculators/real-mode';`),
        `${name} import`,
      ).toBe(true);
      expect(CONVERTER_RE.test(`const v = ${name}(a, b);`), `${name} call`).toBe(true);
    }
  });

  it('the defining modules export no basis converter the ratchet has not been told about', () => {
    expect(
      declaredConverters(),
      'a new real/nominal value export of a defining module is unratcheted from day one: ' +
        'add it to CONTRACT_CONVERTERS *and* CONVERTER_RE, or rename it out of the ' +
        'converter vocabulary if it converts nothing',
    ).toEqual([...CONTRACT_CONVERTERS].sort());
  });

  it('STORE_RE catches EVERY basis-state seam, the test-only reader included', () => {
    // Review fix (MINOR 4): the exported read seam was not matched, so any
    // component could have read the raw basis through it and stayed green.
    for (const seam of [
      'useDollarBasis',
      'useDollarBasisStore',
      '__resetDollarBasisForTests',
      '__readInitialDollarBasisForTests',
    ]) {
      expect(
        STORE_RE.test(`import { ${seam} } from '@/lib/calculators/dollar-basis';`),
        seam,
      ).toBe(true);
    }
    expect(STORE_RE.test('const useDollarBasisLike = 1;')).toBe(false);
    expect(BASIS_KEY_RE.test("sessionStorage.getItem('calc-basis:calculators')")).toBe(true);
  });

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
    expect(CONVERTER_RE.test('const toRealistic = true;')).toBe(false);
  });

  it('CONVERTER_NAMES is CONVERTER_RE\'s alternation, exactly (one list, never two drifting copies)', () => {
    expect([...CONVERTER_NAMES].sort()).toEqual([...CONTRACT_CONVERTERS].sort());
    for (const name of CONVERTER_NAMES) expect(CONVERTER_RE.test(name), name).toBe(true);
  });

  it('the re-export detector catches every aliasing shape (B2 MINOR 4 mutant M5 verbatim first) and never a plain export', () => {
    // planted violations — each must be found
    for (const planted of [
      "export { realRateOfUnfloored as rateLeg } from './real-rate';", // M5, verbatim
      "export { toReal } from '@/lib/scenarios/real';", // a pass-through re-export from a defining module
      "export {\n  toRealSummary,\n  compoundInterestSeries,\n} from '@/lib/compound-interest';",
      "export * from './real-mode';",
      "export * as rates from '../calculators/real-rate.ts';",
      'export { realRateOf as rateLeg };',
      'export { realRateOf as default };',
      'export const rateLeg = realRateOf;',
      'export const rateLeg: typeof realRateOf = realRateOf;',
      'export default toRealSeries;',
      // plan review R1-1: the same hole in its other spellings
      "import { realRateOfUnfloored as rateLeg } from './real-rate';\nexport { rateLeg };", // M5 in two steps
      "import { realRateOfUnfloored as rateLeg } from './real-rate';\nexport { rateLeg as leg };",
      "import {\n  toReal as deflate,\n} from '@/lib/scenarios/real';\nexport const leg = deflate;",
      "import { toRealSeries as series } from './real-mode';\nexport default series;",
      "import * as rr from './real-rate';\nexport { rr };",
      'export const rateLeg = realRateOf\nexport const other = 1;', // no semicolon (ASI)
      'export default toRealSeries\n',
      "export * from './real-mode.js';",
      "export { toRealValue } from '@/lib/calculators/real-rate.js';",
      // P5 review round: a function-type annotation, a local alias exported by
      // list, and an `as`-cast / parenthesized alias
      'export const rateLeg: (a: number, b: number) => number = realRateOf;',
      'const y = realRateOf;\nexport { y };',
      'const a = realRateOf;\nconst b = a;\nexport { b };', // an alias of an alias
      'const y: typeof realRateOf = realRateOf;\nexport { y as rateLeg };',
      "import { realRateOf as rr } from './real-rate';\nconst y = rr;\nexport default y;",
      'export const rateLeg = realRateOf as typeof realRateOf;',
      'export const rateLeg = realRateOf satisfies (a: number, b: number) => number;',
      'export const rateLeg = (realRateOf);',
      'export const rateLeg = (realRateOf as typeof realRateOf);',
      'export default (toRealSeries);',
    ]) {
      expect(aliasedConverterExports(planted), planted).not.toEqual([]);
    }
    // never a plain export, a non-defining re-export, a type-only re-export, or a comment
    for (const clean of [
      "export {\n  TODAY_PHRASE,\n  TODAY_SUFFIX,\n} from './basis-vocabulary';", // basis-view.ts:24-31's shape
      "export type { ChartDisplayMode } from './real-mode';",
      'export { ConcentrationCardMemo as ConcentrationCard };',
      'export { realRateOf };',
      'export function realRateView(basis: DollarBasis) { return realRateOf(0.07, 0.03); }',
      "// export { realRateOf as rateLeg } from './real-rate';",
      "export { surreal as surrealRateOf } from './surreal-mode';",
      'export const r = realRateOf(0.07, 0.03);', // a computed value, not the converter
      "import { realRateOf as rr } from './real-rate';\nexport const v = rr(0.07, 0.03);",
      "import { realRateOf as rr } from './real-rate';\nexport function f() { return rr(1, 2); }", // a wrapper
      "import * as vocab from './basis-vocabulary';\nexport { vocab };", // not a defining module
      // P5 review round: an INLINE type-only re-export carries no value either
      "export { type ChartDisplayMode } from './real-mode';",
      "export { type ChartDisplayMode, type DollarBasis } from '@/lib/calculators/real-mode';",
      'const v = realRateOf(1, 2);\nexport { v };', // a computed value, not the converter
      'const f = (a: number, b: number) => realRateOf(a, b);\nexport { f };', // a wrapper
    ]) {
      expect(aliasedConverterExports(clean), clean).toEqual([]);
    }
  });
});
