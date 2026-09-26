import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles } from './source-walker';
import { FUTURE_SUFFIX, TODAY_SUFFIX } from '@/lib/calculators/basis-vocabulary';

/**
 * v1.7.1 A-5a (2), B1 chip 6 / B2 review MINOR 5: the SHORT basis marks are
 * authored in ONE place. `(today's $)` and `(future $)` may appear in src/
 * only in src/lib/calculators/basis-vocabulary.ts; every other surface
 * interpolates TODAY_SUFFIX / FUTURE_SUFFIX (or basisSuffix), so a caption
 * retyped as a literal — equivalent by rendered text today, a silent fork the
 * day the vocabulary changes — fails here.
 *
 * Scope (CR-P5-1): the SHORT suffixes only. The long marks ("in today's
 * dollars" / "in future dollars") also live in FROZEN kernel files and a
 * disclosure body, so a long-mark ratchet needs an allowlist ruling first.
 *
 * RAW text, comments INCLUDED (the advice-voice rule-1 precedent): a comment
 * quoting the mark is a draft of copy, and stripComments would also swallow a
 * literal that follows a `//` inside a URL on the same line. The apostrophe
 * spellings caught are exactly SHORT_MARK_RE's list: straight, escaped (\'),
 * curly (U+2019), the JS/JSON escapes \x27 \u0027 \u2019 \u{2019}, and the
 * HTML entities &apos; &rsquo; &#39; &#8217; &#x27; &#x2019;.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

/** The ONE module allowed to author the marks. Must stay load-bearing (pinned below). */
const VOCABULARY_MODULE = 'src/lib/calculators/basis-vocabulary.ts';

/** `(today's $)` in each listed apostrophe spelling, or `(future $)`. */
const SHORT_MARK_RE =
  /\((?:today(?:'|’|\\'|\\x27|\\u0027|\\u2019|\\u\{0*(?:27|2019)\}|&apos;|&rsquo;|&#0*(?:39|8217);|&#[xX]0*(?:27|2019);)s|future) \$\)/;

/** Authored-copy carriers: code and data (the trivia bank is JSON). */
const EXTS = ['.ts', '.tsx', '.json'];

async function markOffenders(): Promise<string[]> {
  const files = await collectSourceFiles(SRC, EXTS);
  return files
    .map(rel)
    .filter((r) => r !== VOCABULARY_MODULE)
    .filter((r) => SHORT_MARK_RE.test(readFileSync(path.join(ROOT, r), 'utf8')));
}

describe('basis vocabulary — the short marks are authored once (A-5a)', () => {
  it("no src file outside basis-vocabulary.ts spells (today's $) or (future $)", async () => {
    expect(
      await markOffenders(),
      'interpolate TODAY_SUFFIX / FUTURE_SUFFIX (or basisSuffix) from @/lib/calculators/basis-vocabulary — never retype the mark',
    ).toEqual([]);
  });

  it('the exemption is load-bearing: the vocabulary module authors BOTH marks, and they are the marks this rule hunts', () => {
    const src = readFileSync(path.join(ROOT, VOCABULARY_MODULE), 'utf8');
    expect(src).toContain(`export const TODAY_SUFFIX = "(today's $)";`);
    expect(src).toContain(`export const FUTURE_SUFFIX = '(future $)';`);
    expect(SHORT_MARK_RE.test(TODAY_SUFFIX)).toBe(true);
    expect(SHORT_MARK_RE.test(FUTURE_SUFFIX)).toBe(true);
  });

  it('the scan really scans: all of src/ (> 600 files, .json included), the vocabulary module among them', async () => {
    const files = (await collectSourceFiles(SRC, EXTS)).map(rel);
    expect(files.length).toBeGreaterThan(600);
    expect(files).toContain(VOCABULARY_MODULE);
    expect(files.some((f) => f.endsWith('.json'))).toBe(true);
  });

  it('the detector catches every retype shape (planted) and never a neighbour', () => {
    for (const planted of [
      `label="Window replay (today's $)"`,
      `label={'Portfolio (today\\'s $)'}`,
      'label={`Balance ${x} (today’s $)`}',
      '<span>at 18 (future $)</span>',
      '<span>at 18 (today&apos;s $)</span>',
      '<span>(today&#39;s $)</span>',
      '// the caption reads (future $)',
      '"answer": "Shown in (today\'s $)"',
      // plan review R1-2: the escape and numeric-entity spellings
      '"answer": "Shown in (today\\u2019s $)"', // the JSON escape (trivia bank)
      '"answer": "Shown in (today\\u0027s $)"',
      "label={'Portfolio (today\\x27s $)'}",
      "label={'Portfolio (today\\u{2019}s $)'}",
      '<span>(today&#x27;s $)</span>',
      '<span>(today&#8217;s $)</span>',
      '<span>(today&rsquo;s $)</span>',
    ]) {
      expect(SHORT_MARK_RE.test(planted), planted).toBe(true);
    }
    for (const clean of [
      'label={`Window replay ${TODAY_SUFFIX}`}',
      "<span>at 18 {FUTURE_SUFFIX}</span>",
      "in today's dollars", // the long register — out of this rule's scope (CR-P5-1)
      '(real $)',
      "(today's dollars)",
      '(future dollars)',
      "today's $",
    ]) {
      expect(SHORT_MARK_RE.test(clean), clean).toBe(false);
    }
  });
});
