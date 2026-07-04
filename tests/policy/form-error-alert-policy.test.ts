import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Wave-4 a11y: every canonical form error-summary pane (the
// `border-destructive/50 bg-destructive/10` idiom) must be role="alert"
// so screen readers announce validation failures on submit instead of
// silently blocking the save. The role sits on the same JSX tag —
// in this codebase that is always the same line or within the 4 lines
// above the className line (attribute-per-line formatting).
// Escape hatch: `// error-alert-policy: allow` on the className line.

const ROOT = process.cwd();
const IDIOM = /border-destructive\/50 bg-destructive\/10/;
const ALLOW_MARKER = '// error-alert-policy: allow';

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.tsx$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe('form error-summary panes announce themselves', () => {
  it('every border-destructive/50 bg-destructive/10 pane has role="alert"', () => {
    const violations: string[] = [];
    for (const file of walk(path.join(ROOT, 'src'))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!IDIOM.test(line) || line.includes(ALLOW_MARKER)) return;
        const window = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
        if (!window.includes('role="alert"')) {
          violations.push(`${path.relative(ROOT, file)}:${i + 1}`);
        }
      });
    }
    expect(
      violations,
      `Add role="alert" to the error pane's element. Offenders:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
