/**
 * Shared helpers for tests/policy/* source-scanning tests. Extracted from
 * recharts-animation-policy.test.ts (Wave 5) so the migration/IPC/clock
 * policies reuse one walker instead of three drifting copies.
 *
 * NOT a test file (no .test. suffix) — vitest ignores it; policy tests
 * import from it.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

export async function collectSourceFiles(
  dir: string,
  exts: string[] = ['.ts', '.tsx'],
): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectSourceFiles(full, exts)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

export function lineNumberOf(source: string, index: number): number {
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
export function stripComments(source: string): string {
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
