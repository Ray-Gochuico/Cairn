import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * v1.7.1 A-5a (7), R4 review MINOR 3: `addMonthsYm` is month arithmetic by
 * STRING — "never a Date for month arithmetic" (kernel-dates.ts:6-15; Jan 31
 * + 1 through a Date lands on Mar 3). Its own table cannot tell: a
 * `new Date(y, m + n, 1)` body passes it (the MUTANT NOTE in
 * tests/lib/interview/kernel-dates.test.ts:22-25). This pin reads the SOURCE
 * of that one function body. The kernel is FROZEN — the file is read, never
 * edited. The same file legitimately builds Dates in monthYearLabel and
 * localDayOfInstant, so the pin is scoped to the function body.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const KERNEL_DATES = 'src/lib/interview/kernel-dates.ts';

/** The `{…}` body of `export function <name>(` — brace-depth walk from the first `{` after the signature. */
function functionBody(source: string, name: string): string | null {
  const start = source.search(new RegExp(`export function ${name}\\s*\\(`));
  if (start < 0) return null;
  const open = source.indexOf('{', source.indexOf(')', start));
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** Any Date in a body: a constructor, a static (Date.UTC / Date.now / Date.parse), or a Date setter/getter call. */
const DATE_USE_RE = /\bDate\b|\.(?:set|get)(?:UTC)?(?:FullYear|Month|Date|Day|Time)\s*\(/;

describe('kernel-dates shape — addMonthsYm is string arithmetic, never a Date (A-5a)', () => {
  it('the addMonthsYm body builds no Date and calls no Date accessor', () => {
    const body = functionBody(readFileSync(path.join(ROOT, KERNEL_DATES), 'utf8'), 'addMonthsYm');
    expect(body, `${KERNEL_DATES}: addMonthsYm not found — renamed? re-point this pin, never delete it`).not.toBeNull();
    expect(body!.trim().length).toBeGreaterThan(0);
    expect(body).not.toMatch(DATE_USE_RE);
    expect(body).not.toContain('new Date(');
  });

  it('the scoping is load-bearing: the same file DOES build Dates elsewhere, so a file-level scan would be wrong', () => {
    const src = readFileSync(path.join(ROOT, KERNEL_DATES), 'utf8');
    expect(src).toMatch(DATE_USE_RE);
    expect(functionBody(src, 'monthYearLabel')).toContain('new Date(');
  });

  it('the extractor + detector catch a planted Date body (the MUTANT NOTE shape) and read nested braces whole', () => {
    const planted = [
      'export function addMonthsYm(ym: YearMonth, n: number): YearMonth {',
      '  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1);',
      "  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;",
      '}',
    ].join('\n');
    expect(functionBody(planted, 'addMonthsYm')).toMatch(DATE_USE_RE);
    for (const shape of ['Date.UTC(y, m + n, 1)', 'const d = ctx.today; d.setUTCMonth(d.getUTCMonth() + n);', 'new Date (y, m)']) {
      expect(functionBody(`export function addMonthsYm(ym: string, n: number): string { ${shape} }`, 'addMonthsYm'), shape).toMatch(DATE_USE_RE);
    }
    const nested = 'export function addMonthsYm(ym: string, n: number): string {\n  if (n) { return `${ym}`; }\n  return ym;\n}\nexport function later() { return new Date(0); }';
    expect(functionBody(nested, 'addMonthsYm')).toBe('\n  if (n) { return `${ym}`; }\n  return ym;\n');
    expect(functionBody(nested, 'addMonthsYm')).not.toMatch(DATE_USE_RE);
    expect(functionBody('export const x = 1;', 'addMonthsYm')).toBeNull();
  });
});
