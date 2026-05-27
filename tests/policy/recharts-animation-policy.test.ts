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
const CHART_TAG_RE = /<(Pie|Bar|Line|Area)\b[^>]*>/gs;
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

      CHART_TAG_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = CHART_TAG_RE.exec(stripped)) !== null) {
        const tag = match[0];
        if (tag.includes(REQUIRED_PROP)) continue;
        const rel = path.relative(path.resolve(__dirname, '..', '..'), file);
        offenders.push({
          file: rel,
          line: lineNumberOf(stripped, match.index),
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
});
