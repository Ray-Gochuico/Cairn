import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { collectSourceFiles, lineNumberOf, stripComments } from './source-walker';

/**
 * v1.7.0 W-I: the advice-voice ratchet, promoted from W2's five-file scope to
 * ALL of src/ (D-I9). Three rules:
 *
 *  1. No advice voice anywhere in a file, comments INCLUDED (W2's regex,
 *     byte-identical — a comment that reads as advice is a draft of copy
 *     waiting to be pasted). Zero hits at ed659f7a.
 *  2. No exclamation mark in an AUTHORED string. W2's literal scanner,
 *     byte-identical, with `${…}` bodies blanked (they hold operators, not
 *     copy) and ONE explicit, load-bearing allowlisted literal (a SQL `!=`).
 *     Literal-scoped on purpose: `!` is also the negation operator.
 *  3. Copy never calls ITSELF advice (advice / advise(s|d) / advising /
 *     recommend(s|ed|ation|ations)). Two OUT strata and two exact allowlisted
 *     disclaimer sentences — every exemption must stay load-bearing, so a
 *     stale one fails this file rather than widening it in silence.
 *
 * Honest limits (chipped): JSX text runs (`<p>…</p>`) are not string literals
 * and are not scanned — a regex JSX scan false-positives on
 * `{n > 0 && !flag && <X/>}`; an AST walker is the fix. The quote-pairing
 * scanner can be confused by an apostrophe in a same-line comment (W2 shape).
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

/* ── Rule 1 ─────────────────────────────────────────────────────────────── */
export const ADVICE = /\b(you should|we recommend|it'?s best to)\b/i;

/* ── Rule 2 ─────────────────────────────────────────────────────────────── */
/** Single-quoted, double-quoted and template literals (W2, byte-identical). */
const STRING_LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

/** ONE entry; adding another is a review event. Each must stay load-bearing. */
const BANG_ALLOW: ReadonlyArray<{ file: string; literalPrefix: string; why: string }> = [
  {
    file: 'src/domain/snapshots.ts',
    literalPrefix: 'INSERT INTO account_snapshots',
    why: "SQL: `!=` is SQLite's inequality operator inside an upsert, not authored copy",
  },
];

/* ── Rule 3 ─────────────────────────────────────────────────────────────── */
/** Hyphen-guarded so "donor-advised" is not a hit; "advisor"/"advisory"/"advisers" never match. */
const SELF_ADVICE = /(?<![\w-])(advice|advise[sd]?|advising|recommend(?:s|ed|ation|ations)?)\b/i;

/** OUT of rule 3 only. Each prefix must still contain ≥ 1 hit (load-bearing). */
const RULE3_OUT: ReadonlyArray<{ prefix: string; why: string }> = [
  {
    prefix: 'src/legal/',
    why: 'disclosure bodies and their acceptance checkboxes legitimately say "not … advice"',
  },
  {
    prefix: 'src/domain/roadmap/',
    why: 'the adapted community flow chart says "recommended" three times — pre-existing copy; chip W-I-3 rewords it, then this entry goes',
  },
];

/** Exact disclaimer sentences that NAME the register instead of using it. Each must be present verbatim. */
const RULE3_ALLOW: ReadonlyArray<{ file: string; sentence: string }> = [
  {
    file: 'src/lib/interview/framework-cards.ts',
    sentence: 'One mechanical framework applied to your numbers — not advice, not a recommendation.',
  },
  {
    file: 'src/lib/whatif/plan-review.ts',
    sentence:
      'A mechanical comparison of two scenarios you built — not advice, not a recommendation.',
  },
];

/** W2's enrolment — the promotion may never drop a file. */
const W2_ENROLLED = [
  'src/lib/history-fan.ts',
  'src/lib/calculators/history-fan-copy.ts',
  'src/lib/calculators/use-chart-source.ts',
  'src/components/calculators/ReturnSourceControl.tsx',
  'src/components/calculators/HistoryFanLegend.tsx',
];

/* ── Scanner pieces (each has a self-test below) ─────────────────────────── */

/** Blank `${…}` bodies in a template literal (brace-depth aware). */
export function blankInterpolations(lit: string): string {
  if (lit[0] !== '`') return lit;
  let out = '';
  for (let i = 0; i < lit.length; ) {
    if (lit[i] === '$' && lit[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < lit.length && depth > 0) {
        if (lit[i] === '{') depth += 1;
        else if (lit[i] === '}') depth -= 1;
        i += 1;
      }
      out += '${}';
      continue;
    }
    out += lit[i];
    i += 1;
  }
  return out;
}

/** Authored strings of a comment-stripped source: literals with interpolations blanked. */
export function authoredStrings(stripped: string): string[] {
  return (stripped.match(STRING_LITERAL) ?? []).map(blankInterpolations);
}

const unquote = (lit: string) => lit.slice(1, -1);
const bangAllowed = (file: string, lit: string) =>
  BANG_ALLOW.some((a) => a.file === file && unquote(lit).startsWith(a.literalPrefix));
const rule3Out = (file: string) => RULE3_OUT.some((o) => file.startsWith(o.prefix));
const rule3Allowed = (file: string, lit: string) =>
  RULE3_ALLOW.some((a) => a.file === file && lit.includes(a.sentence));

/* ── The ratchet ─────────────────────────────────────────────────────────── */

let files: string[] = [];
beforeAll(async () => {
  files = (await collectSourceFiles(SRC)).sort();
});

describe('advice-voice ratchet (W-I, all of src/)', () => {
  it('walks the whole of src/ and still covers every file W2 enrolled', () => {
    expect(files.length).toBeGreaterThan(600);
    const walked = new Set(files.map(rel));
    for (const f of W2_ENROLLED) expect(walked.has(f), f).toBe(true);
  });

  it('rule 1: no advice voice anywhere in src (comments included)', () => {
    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const m = src.match(ADVICE);
      if (m && m.index !== undefined) hits.push(`${rel(f)}:${lineNumberOf(src, m.index)}: "${m[0]}"`);
    }
    expect(hits).toEqual([]);
  });

  it('rule 2: no exclamation mark in any authored string in src', () => {
    const hits: string[] = [];
    for (const f of files) {
      const file = rel(f);
      for (const lit of authoredStrings(stripComments(readFileSync(f, 'utf8')))) {
        if (lit.includes('!') && !bangAllowed(file, lit)) hits.push(`${file}: ${lit.slice(0, 80)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('rule 3: copy never calls itself advice (outside the OUT strata and the allowlisted sentences)', () => {
    const hits: string[] = [];
    for (const f of files) {
      const file = rel(f);
      if (rule3Out(file)) continue;
      for (const lit of authoredStrings(stripComments(readFileSync(f, 'utf8')))) {
        const m = lit.match(SELF_ADVICE);
        if (m && !rule3Allowed(file, lit)) hits.push(`${file}: "${m[0]}" in ${lit.slice(0, 80)}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('every exemption is load-bearing (a stale one fails here instead of widening the ratchet)', () => {
  it('BANG_ALLOW: each entry names a literal that exists, starts with the prefix and carries a !', () => {
    for (const a of BANG_ALLOW) {
      const lits = authoredStrings(stripComments(readFileSync(path.join(ROOT, a.file), 'utf8')));
      const hit = lits.find((l) => unquote(l).startsWith(a.literalPrefix) && l.includes('!'));
      expect(
        hit,
        `${a.file}: "${a.literalPrefix}…" no longer needs the exemption — delete the entry`,
      ).toBeDefined();
    }
  });

  it('RULE3_OUT: each stratum still contains at least one rule-3 hit', () => {
    for (const o of RULE3_OUT) {
      const inStratum = files.filter((f) => rel(f).startsWith(o.prefix));
      expect(inStratum.length, o.prefix).toBeGreaterThan(0);
      const hit = inStratum.some((f) =>
        authoredStrings(stripComments(readFileSync(f, 'utf8'))).some((l) => SELF_ADVICE.test(l)),
      );
      expect(hit, `${o.prefix} no longer needs the exemption — delete the entry`).toBe(true);
    }
  });

  it('RULE3_ALLOW: each sentence is present verbatim in its file and actually needs the exemption', () => {
    for (const a of RULE3_ALLOW) {
      expect(readFileSync(path.join(ROOT, a.file), 'utf8')).toContain(a.sentence);
      expect(SELF_ADVICE.test(a.sentence)).toBe(true);
    }
  });
});

describe('the detectors (an untested detector is a bypass)', () => {
  it('the literal scanner actually finds strings (W2 self-test, verbatim)', () => {
    const sample = `const a = 'hi!'; const b = "ok"; const c = \`x!\`; if (!z) return;`;
    const found = (sample.match(STRING_LITERAL) ?? []).filter((s) => s.includes('!'));
    expect(found).toEqual(["'hi!'", '`x!`']);
  });

  it('interpolation bodies are blanked (operators are not copy); authored text around them is kept', () => {
    expect(blankInterpolations('`Year ${y}${override != null ? `${a}` : ""} done`')).toBe(
      '`Year ${}${} done`',
    );
    expect(blankInterpolations('`Account name matches ${res.matches!.length} accounts`')).toBe(
      '`Account name matches ${} accounts`',
    );
    expect(blankInterpolations('`Great news ${x}!`')).toBe('`Great news ${}!`');
    expect(blankInterpolations("'plain!'")).toBe("'plain!'");
  });

  it('rule 3 lexicon: self-description forms match; hyphenated compounds and "advisor" do not', () => {
    for (const s of [
      'not advice',
      'We advise caution',
      'the recommended branch',
      'optional but recommended',
      'a recommendation',
      'advising',
    ]) {
      expect(SELF_ADVICE.test(s), s).toBe(true);
    }
    for (const s of ['a donor-advised fund', 'your advisor', 'an advisory note', 'advisers']) {
      expect(SELF_ADVICE.test(s), s).toBe(false);
    }
  });

  it("rule 1's regex is W2's (the promotion changed coverage, not the rule)", () => {
    expect(ADVICE.source).toBe("\\b(you should|we recommend|it'?s best to)\\b");
    expect(ADVICE.flags).toBe('i');
  });
});
