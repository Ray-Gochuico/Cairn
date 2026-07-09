import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles } from './source-walker';

// Round-3 chip D (task_231ee239) — the 10th ratchet: every Dialog/Sheet
// content must carry an accessible description (a DialogDescription /
// SheetDescription child, or an explicit aria-describedby). Radix dev-warns
// on each offender; screen-reader users get a nameless modal. Escape hatch:
// `// dialog-description-policy: allow — <reason>` in the first 5 lines.

const SRC = path.resolve(__dirname, '..', '..', 'src');
const ALLOW = '// dialog-description-policy: allow';
// Concatenated so this file never matches its own patterns.
const CONTENT_TOKENS = ['<Dialog' + 'Content', '<Sheet' + 'Content'];
const DESC_TOKENS = ['Dialog' + 'Description', 'Sheet' + 'Description', 'aria-describedby'];

function violates(source: string): boolean {
  if (!CONTENT_TOKENS.some((t) => source.includes(t))) return false;
  if (source.split('\n', 5).join('\n').includes(ALLOW)) return false;
  return !DESC_TOKENS.some((t) => source.includes(t));
}

describe('dialog-description policy (round-3 chip D — 10th ratchet)', () => {
  it('every Dialog/Sheet content has an accessible description', async () => {
    const offenders: string[] = [];
    for (const file of await collectSourceFiles(SRC, ['.tsx'])) {
      if (violates(await readFile(file, 'utf8'))) {
        offenders.push(path.relative(SRC, file));
      }
    }
    expect(
      offenders,
      `Add a DialogDescription/SheetDescription (sr-only is fine) or the allow marker WITH a reason:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  describe('violates() self-tests', () => {
    it('flags a content with no description', () => {
      expect(violates(`<${'Dialog'}Content>x</div>`)).toBe(true);
      expect(violates(`<${'Sheet'}Content>x</div>`)).toBe(true);
    });
    it('accepts a description child or explicit aria-describedby', () => {
      expect(violates(`<${'Dialog'}Content><${'Dialog'}Description>d</div>`)).toBe(false);
      expect(violates(`<${'Dialog'}Content aria-describedby="x">`)).toBe(false);
    });
    it('honors the top-of-file allow marker', () => {
      expect(violates(`${ALLOW} — decorative\n<${'Dialog'}Content>`)).toBe(false);
    });
    it('ignores files without dialog content', () => {
      expect(violates('export const x = 1;')).toBe(false);
    });
  });
});
