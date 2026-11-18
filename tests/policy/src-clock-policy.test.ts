import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, moduleScopeClockReads } from './source-walker';

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(ROOT, 'src');

// ---------------------------------------------------------------------------
// v1.8.0 W4 (C174 (c); v171-11 A2 chip (f)): no clock read at module scope
// in src.
//
// A no-argument `new Date()` or `Date.now()` that runs when a module loads
// (outside every function, method and instance initializer) is fixed for the
// life of the page: it goes stale across midnight and New Year, and no test
// that renders the module can move it, because the read happened at import.
// Read the clock inside the function that needs it (or take `today` as an
// argument). The allowlist is shrink-only.
// ---------------------------------------------------------------------------
const MODULE_SCOPE_CLOCK_ALLOWLIST: ReadonlySet<string> = new Set([
  // `const CURRENT_YEAR = new Date().getFullYear()` (:24). C049 (a later wave)
  // replaces it; that lane prunes this entry.
  'src/components/contributions/AnnualTotalDialog.tsx',
]);

function rel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

async function offenders(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const file of await collectSourceFiles(SRC_DIR, ['.ts', '.tsx'])) {
    const name = rel(file);
    const reads = moduleScopeClockReads(readFileSync(file, 'utf8'), name);
    if (reads.length > 0) out.set(name, reads.map((r) => `${name}:${r.line} ${r.text}`));
  }
  return out;
}

describe('src module-scope clock policy', () => {
  it('src files reading the clock at module scope ⊆ frozen allowlist', async () => {
    const found = await offenders();
    const fresh = [...found.keys()].filter((f) => !MODULE_SCOPE_CLOCK_ALLOWLIST.has(f));
    if (fresh.length > 0) {
      throw new Error(
        [
          '',
          'New module-scope clock read(s) in src:',
          ...fresh.flatMap((f) => found.get(f) ?? []),
          '',
          'Read the clock inside the function that needs it, or take today as an argument.',
          '',
        ].join('\n'),
      );
    }
    expect(fresh).toEqual([]);
  });

  it('allowlist hygiene: entries that no longer offend must be pruned', async () => {
    const found = await offenders();
    expect([...MODULE_SCOPE_CLOCK_ALLOWLIST].filter((f) => !found.has(f))).toEqual([]);
  });

  describe('the module-scope detector (self-tests)', () => {
    const lines = (src: string) => moduleScopeClockReads(src, 'src/fixture.tsx').map((r) => r.line);

    it('flags a top-level read, a static class field and an immediately invoked function at load', () => {
      const src = [
        'const Y = new Date().getFullYear();',
        'export const STAMP = Date.now();',
        'class Clock { static readonly started = new Date(); }',
        'const viaIife = (() => new Date())();',
      ].join('\n');
      expect(lines(src)).toEqual([1, 2, 3, 4]);
    });

    it('a read inside a function, an arrow, a method, a component or an instance field is not module scope', () => {
      const src = [
        'function thisYear() { return new Date().getFullYear(); }',
        'const now = () => Date.now();',
        'class Clock { at = new Date(); read() { return new Date(); } }',
        'export function Card() { const y = new Date().getFullYear(); return y; }',
        'const handlers = { onClick: () => new Date() };',
      ].join('\n');
      expect(lines(src)).toEqual([]);
    });

    it('ignores clock text in strings and comments, and dated constructions', () => {
      const src = [
        '// const Y = new Date().getFullYear();',
        "const label = 'new Date()';",
        "const FIXED = new Date('2026-01-01T00:00:00');",
      ].join('\n');
      expect(lines(src)).toEqual([]);
    });
  });
});
