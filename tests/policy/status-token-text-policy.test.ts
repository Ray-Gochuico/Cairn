import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Wave-4 a11y policy: bare `text-success|text-warning|text-info|
// text-destructive` classes render the saturated FILL tokens as TEXT and
// fail WCAG AA (light success 2.30:1, warning 2.14:1, info 2.85:1; dark
// destructive 2.00:1). The readable text tokens are
// text-{success,warning,info}-foreground and text-destructive-soft-
// foreground (see src/globals.css token comments and the mapping rule in
// docs/superpowers/plans/2026-07-02-wave-4-a11y.md).
//
// Allowed without a marker:
//   - suffixed tokens (text-success-foreground, text-destructive-soft-…)
//   - variant-prefixed states (hover:text-destructive — resting color is
//     AA; precedent in tests/styles/destructive-token-contrast.test.ts)
//   - bg-/border-/fill contexts (different utility names, never matched)
// Escape hatch for a future legitimate case (e.g. a decorative glyph on a
// guaranteed-dark surface): put `// status-token-policy: allow` on the
// same line.

const SRC_DIR = path.resolve(__dirname, '..', '..', 'src');
const BARE_RE = /(?<![\w:-])text-(success|warning|info|destructive)(?![\w-])/;
const ALLOW_MARKER = '// status-token-policy: allow';

async function collectSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectSourceFiles(full)));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Strip // and /* */ comments, preserving newlines so reported line
// numbers stay aligned (same approach as recharts-animation-policy).
function stripComments(source: string): string {
  const out: string[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    if (source[i] === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out.push(source[i] === '\n' ? '\n' : ' ');
        i += 1;
      }
      i += 2;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    out.push(source[i]);
    i += 1;
  }
  return out.join('');
}

describe('status-token text policy', () => {
  it('src/ has zero bare text-{success|warning|info|destructive} classes', async () => {
    const violations: string[] = [];
    for (const file of await collectSourceFiles(SRC_DIR)) {
      const raw = await readFile(file, 'utf8');
      const rawLines = raw.split('\n');
      const lines = stripComments(raw).split('\n');
      lines.forEach((line, idx) => {
        if (!BARE_RE.test(line)) return;
        if (rawLines[idx]?.includes(ALLOW_MARKER)) return;
        const rel = path.relative(path.resolve(__dirname, '..', '..'), file);
        violations.push(`  ${rel}:${idx + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
    expect(
      violations,
      [
        '',
        `Bare status-color text class(es) found (WCAG AA fail as text):`,
        ...violations,
        '',
        'Fix: text-{success|warning|info} → text-{status}-foreground;',
        '     text-destructive → text-destructive-soft-foreground.',
        `Escape: append \`${ALLOW_MARKER}\` to the line (justify in a comment).`,
        '',
      ].join('\n'),
    ).toEqual([]);
  });
});
