import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-level policy guard for the recharts 3.x render-loop escape hatch.
//
// recharts 3.x calls `useAnimationId(props)` inside Pie/Bar internals with
// reference-equality on the entire props object, which means a fresh
// `_objectSpread` on every render remounts `<JavascriptAnimate>` and trips
// React 19's "Maximum update depth exceeded". See
// docs/superpowers/conventions.md § "Library gotchas" for the full root-
// cause walk-through. The accepted escape hatch is `isAnimationActive={false}`
// on every <Pie>, <Bar>, <Line>, and <Area> usage.
//
// This test walks src/**/*.{ts,tsx}, finds every <Pie|<Bar|<Line|<Area JSX
// open tag (multi-line aware), and asserts isAnimationActive={false} is in
// the prop list. Files with a top-of-file `// recharts-policy: allow`
// comment are exempted (escape hatch for future cases).
//
// Replaces the InvestmentTimeSeriesChart sentinel test pattern, which
// admitted in its own comment that jsdom can't drive recharts' animation
// lifecycle — see tests/components/InvestmentTimeSeriesChart.test.tsx.

const SRC_DIR = path.resolve(__dirname, '..', '..', 'src');
const CHART_TAG_OPEN_RE = /<(Pie|Bar|Line|Area)\b/g;
const REQUIRED_PROP = 'isAnimationActive={false}';
const ALLOW_COMMENT = '// recharts-policy: allow';

async function collectSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectSourceFiles(full)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function lineNumberOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) line += 1;
  }
  return line;
}

// Find the end of a JSX opening tag that begins at `startIdx` (the `<`).
// Walks character-by-character tracking string/template literals and JSX-
// expression brace depth so that props like `onClick={(e) => doX(e)}` do
// NOT terminate the tag at the arrow's `>`. Returns the index just past
// the closing `>` (so source.slice(startIdx, end) is the full open tag),
// or -1 if the tag is unterminated.
//
// Why this matters: the previous implementation used `<Bar\b[^>]*>` which
// is greedy-stop-at-first-`>`. A chart tag with an arrow-function prop
// would match only up to the arrow and miss `isAnimationActive={false}`
// further down the prop list. Zero current impact (no charts use such
// props today), but defensive against future drift.
function findJsxTagEnd(source: string, startIdx: number): number {
  let braceDepth = 0;
  // Quote state: '\0' = none, '"' / "'" = string, '`' = template literal.
  let quote = '\0';
  let i = startIdx + 1; // skip the leading '<'
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    // Inside a string/template literal, only the matching closing quote
    // (and `\` escape, and for templates the `${...}` interpolation)
    // affect state.
    if (quote !== '\0') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (quote === '`' && ch === '$' && source[i + 1] === '{') {
        braceDepth += 1;
        i += 2;
        // Track this brace as belonging to the template's interpolation —
        // it must close before the template's closing backtick. We treat
        // it as a normal brace bump and pop on '}' below; the template
        // remains open until we see another '`'.
        // Re-enter quote state but allow nested braces to be counted.
        // (Simplest model: the interpolation is just like a normal JSX
        // expression — we leave the template-quote mode for the
        // duration of the interpolation.)
        quote = '\0';
        continue;
      }
      if (ch === quote) {
        quote = '\0';
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    // Not in a string. JSX expressions use {...} which may contain ANY
    // characters including `>`, arrow functions, nested object literals,
    // etc. Track depth so the tag-end `>` is only recognized at depth 0.
    if (ch === '{') {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      braceDepth -= 1;
      i += 1;
      continue;
    }
    if (braceDepth === 0) {
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        i += 1;
        continue;
      }
      // Self-closing tag end '/>'
      if (ch === '/' && source[i + 1] === '>') {
        return i + 2;
      }
      if (ch === '>') {
        return i + 1;
      }
    } else {
      // Inside a JSX expression, string literals still need tracking so
      // that `'abc{}'` inside a prop doesn't bump brace depth.
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        i += 1;
        continue;
      }
    }
    i += 1;
  }
  return -1;
}

// Strip `//` line comments and `/* */` block comments while preserving line
// numbers (each removed char becomes a space, newlines preserved). This keeps
// regex match indices aligned with the original source so error messages
// still point at the right line. Without this, JSX comments like
// `// <JavascriptAnimate>` inside a multi-line <Bar ...> prop list would
// prematurely terminate the `[^>]*` match at the `>` in the comment.
function stripComments(source: string): string {
  const out: string[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    // Block comment
    if (ch === '/' && next === '*') {
      out.push('  ');
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out.push(source[i] === '\n' ? '\n' : ' ');
        i += 1;
      }
      if (i < n) {
        out.push('  ');
        i += 2;
      }
      continue;
    }
    // Line comment
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out.push(' ');
        i += 1;
      }
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join('');
}

describe('recharts animation policy', () => {
  it('every <Pie|<Bar|<Line|<Area JSX usage in src/ sets isAnimationActive={false}', async () => {
    const files = await collectSourceFiles(SRC_DIR);
    const offenders: { file: string; line: number; snippet: string }[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      // Allow-list mechanism: a top-of-file comment exempts the file.
      // Look for the marker anywhere in the first 5 lines.
      const head = source.split('\n', 5).join('\n');
      if (head.includes(ALLOW_COMMENT)) continue;

      // Strip comments first so multi-line <Bar ...> prop lists that contain
      // a JSX-comment with a `>` character don't terminate the tag match
      // prematurely. Line numbers are preserved by stripComments.
      const stripped = stripComments(source);

      CHART_TAG_OPEN_RE.lastIndex = 0;
      let open: RegExpExecArray | null;
      while ((open = CHART_TAG_OPEN_RE.exec(stripped)) !== null) {
        const tagStart = open.index;
        const tagEnd = findJsxTagEnd(stripped, tagStart);
        if (tagEnd === -1) continue; // unterminated tag; skip
        const tag = stripped.slice(tagStart, tagEnd);
        // Advance the regex past the tag we just consumed so we don't
        // re-match `<Bar` if `findJsxTagEnd` walked over a chunk that
        // contains another chart tag name in a string literal.
        CHART_TAG_OPEN_RE.lastIndex = tagEnd;
        if (tag.includes(REQUIRED_PROP)) continue;
        const rel = path.relative(path.resolve(__dirname, '..', '..'), file);
        offenders.push({
          file: rel,
          line: lineNumberOf(stripped, tagStart),
          snippet: tag.split('\n')[0].trim().slice(0, 80),
        });
      }
    }

    if (offenders.length > 0) {
      const lines = [
        '',
        `Found ${offenders.length} recharts JSX usage(s) missing isAnimationActive={false}:`,
        '',
        ...offenders.map(
          (o) => `  ${o.file}:${o.line}  ${o.snippet}`,
        ),
        '',
        `Fix: add \`isAnimationActive={false}\` to each <Pie|<Bar|<Line|<Area above.`,
        `Why: recharts 3.x render-loop escape hatch — see docs/superpowers/conventions.md § "Library gotchas".`,
        `Escape: add a top-of-file \`${ALLOW_COMMENT}\` comment to exempt a file.`,
        '',
      ].join('\n');
      throw new Error(lines);
    }

    expect(offenders).toEqual([]);
  });

  // Regression guard for the brace-depth-aware tag-end scanner. Without
  // this, the previous `[^>]*>` regex would terminate at the first `>`
  // it saw — including the `>` of an arrow-function prop — and miss the
  // `isAnimationActive={false}` further down in the tag's prop list.
  // See docs/reviews/2026-05-27-frontend-rereview.md / Testing P2-E.
  describe('findJsxTagEnd', () => {
    function captureTag(source: string): string {
      const idx = source.indexOf('<');
      const end = findJsxTagEnd(source, idx);
      return source.slice(idx, end);
    }

    it('walks past an arrow-function prop without terminating at its `>`', () => {
      // The arrow's `>` is inside braces (depth 1). Old regex stopped at
      // the arrow's `>` and the captured tag did NOT include the later
      // `isAnimationActive={false}` — false positive offender. New scanner
      // walks through the brace expression and captures the full tag.
      const src = `<Pie data={data} onClick={(e) => doX(e)} isAnimationActive={false} />`;
      const tag = captureTag(src);
      expect(tag).toBe(src);
      expect(tag.includes('isAnimationActive={false}')).toBe(true);
    });

    it('handles a multi-line tag with arrow prop spanning lines', () => {
      const src = [
        '<Bar',
        '  dataKey="value"',
        '  onMouseOver={(e) => {',
        '    if (e && e.x > 0) doY(e);',
        '  }}',
        '  isAnimationActive={false}',
        '/>',
      ].join('\n');
      const tag = captureTag(src);
      expect(tag).toBe(src);
      expect(tag.includes('isAnimationActive={false}')).toBe(true);
    });

    it('handles string literals containing `>` and `{` characters', () => {
      const src = `<Line label=">>>" tooltip={'{not a brace}'} isAnimationActive={false} />`;
      const tag = captureTag(src);
      expect(tag).toBe(src);
      expect(tag.includes('isAnimationActive={false}')).toBe(true);
    });

    it('handles nested object literals in props', () => {
      const src = `<Area style={{ top: 10, fn: () => 20 }} isAnimationActive={false} />`;
      const tag = captureTag(src);
      expect(tag).toBe(src);
      expect(tag.includes('isAnimationActive={false}')).toBe(true);
    });

    it('terminates at the closing `>` of a non-self-closing tag', () => {
      const src = `<Pie data={[]} isAnimationActive={false}>child</Pie>`;
      const tag = captureTag(src);
      expect(tag).toBe(`<Pie data={[]} isAnimationActive={false}>`);
    });
  });
});
