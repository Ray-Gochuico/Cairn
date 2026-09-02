import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * W2 D-P5: the spec's advice-grep, scoped to the modules this wave ships.
 * v1.5.0 shipped no advice-voice policy test, so this file creates one at W2's
 * scope; promoting it to an all-copy ratchet is a follow-up chip.
 *
 * Two rules:
 *  - no advice voice anywhere in the file (comments included — a comment that
 *    reads as advice is a draft of copy waiting to be pasted);
 *  - no exclamation marks in AUTHORED STRINGS. The scan is literal-scoped on
 *    purpose: `!` is also the boolean-negation operator, so a whole-file scan
 *    would forbid ordinary guard clauses rather than an excited sentence.
 */
const ENROLLED = [
  'src/lib/history-fan.ts',
  'src/lib/calculators/history-fan-copy.ts',
  'src/lib/calculators/use-chart-source.ts',
  'src/components/calculators/ReturnSourceControl.tsx',
  'src/components/calculators/HistoryFanLegend.tsx',
];
const ADVICE = /\b(you should|we recommend|it'?s best to)\b/i;
/** Single-quoted, double-quoted and template literals. */
const STRING_LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

describe('advice-voice policy (W2 scope)', () => {
  for (const rel of ENROLLED) {
    it(`${rel} carries no advice voice`, () => {
      expect(readFileSync(rel, 'utf8')).not.toMatch(ADVICE);
    });
    it(`${rel} has no exclamation marks in authored strings`, () => {
      const literals = readFileSync(rel, 'utf8').match(STRING_LITERAL) ?? [];
      expect(literals.filter((s) => s.includes('!'))).toEqual([]);
    });
  }

  it('the literal scanner actually finds strings (an untested detector is a bypass)', () => {
    const sample = `const a = 'hi!'; const b = "ok"; const c = \`x!\`; if (!z) return;`;
    const found = (sample.match(STRING_LITERAL) ?? []).filter((s) => s.includes('!'));
    expect(found).toEqual(["'hi!'", '`x!`']);
  });
});
