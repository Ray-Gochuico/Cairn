import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

/**
 * Design H-1 guard: the import-preview tables shipped with ~29 bare Tailwind
 * `slate-*` utilities that have NO `dark:` variant (low-contrast `text-slate-600`
 * headers, a near-white `hover:bg-slate-100` cell-hover flash on black rows, a
 * bright `border-slate-300` <select> hairline). On the dark card these read as
 * broken. The fix swaps them to the existing semantic tokens that already adapt
 * per theme (text-muted-foreground / hover:bg-muted / border-input), the same
 * tokens the status-badge and row-tint maps in these files already use.
 *
 * This locks the migration: no bare `slate-*` class may reappear anywhere under
 * src/components/import/. Semantic tokens (muted, muted-foreground, input,
 * border, success-*, warning-*, destructive-*) are theme-aware and unaffected.
 */

const ROOT = process.cwd();

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

// Any Tailwind utility ending in a `slate-<n>` shade, with or without a
// variant prefix (hover:, dark:, focus:, etc.) or a leading property segment
// (bg-, text-, border-, ring-, divide-, from-, ...). Matches `text-slate-600`,
// `hover:bg-slate-100`, `border-slate-300`, etc.
const SLATE_RE = /\bslate-\d{2,3}\b/;

describe('import preview: no bare slate-* utilities (dark-mode regression guard)', () => {
  it('uses semantic tokens, not slate-*, across src/components/import/', () => {
    const violations: string[] = [];
    for (const file of walk(path.join(ROOT, 'src/components/import'))) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (SLATE_RE.test(line)) {
            violations.push(`${path.relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
          }
        });
    }
    expect(
      violations,
      'Bare slate-* utilities have no dark: variant and break the dark card. ' +
        'Use text-muted-foreground / hover:bg-muted / border-input instead. Offenders:\n' +
        violations.join('\n'),
    ).toEqual([]);
  });
});
