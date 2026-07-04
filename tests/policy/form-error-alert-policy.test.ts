import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Wave-4 a11y: every canonical form error-summary pane (the
// `border-destructive/50` + `bg-destructive/10` idiom, either order) must be
// role="alert" so screen readers announce validation failures on submit
// instead of silently blocking the save. Wave-5 ride-along R2 hardened the
// check: the role must sit on the SAME JSX tag as the idiom (scan back to
// the nearest `<`, forward to the tag's `>`), not merely within a 4-line
// window that a NEIGHBORING tag's role="alert" could satisfy.
// Escape hatch: `// error-alert-policy: allow` on the className line.

const ROOT = process.cwd();
const BORDER_TOKEN = 'border-destructive/50';
const BG_TOKEN = 'bg-destructive/10';
const ALLOW_MARKER = '// error-alert-policy: allow';

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.tsx$/.test(entry)) acc.push(full);
  }
  return acc;
}

/**
 * Does the JSX tag containing `idiomIdx` carry role="alert"?
 * Tag = nearest `<` before the idiom through the first `>` after it. The
 * error panes are static divs, so a plain `>` scan suffices; a `>` hiding
 * in an intervening expression prop would truncate the window and fail
 * LOUD (false violation), never silently pass. Exported-for-test via the
 * self-test describe below.
 */
function sameTagHasAlert(source: string, idiomIdx: number): boolean {
  const tagStart = source.lastIndexOf('<', idiomIdx);
  const tagEnd = source.indexOf('>', idiomIdx);
  const tag = source.slice(
    tagStart === -1 ? 0 : tagStart,
    tagEnd === -1 ? source.length : tagEnd + 1,
  );
  return /\brole="alert"/.test(tag);
}

/** Column of the first idiom token on a line that contains BOTH tokens (any
 * order, other classes may sit between); -1 when the line is not the idiom. */
function idiomColumn(line: string): number {
  const b = line.indexOf(BORDER_TOKEN);
  const g = line.indexOf(BG_TOKEN);
  if (b === -1 || g === -1) return -1;
  return Math.min(b, g);
}

describe('form error-summary panes announce themselves', () => {
  it('every border-destructive/50 + bg-destructive/10 pane has role="alert" on the same tag', () => {
    const violations: string[] = [];
    for (const file of walk(path.join(ROOT, 'src'))) {
      const source = readFileSync(file, 'utf8');
      const lines = source.split('\n');
      let offset = 0;
      lines.forEach((line, i) => {
        const lineStart = offset;
        offset += line.length + 1; // + '\n'
        const col = idiomColumn(line);
        if (col === -1 || line.includes(ALLOW_MARKER)) return;
        if (!sameTagHasAlert(source, lineStart + col)) {
          violations.push(`${path.relative(ROOT, file)}:${i + 1}`);
        }
      });
    }
    expect(
      violations,
      `Add role="alert" to the error pane's element (the SAME tag as the idiom). Offenders:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  // Self-tests (R2): pin the same-tag semantics + the reversed idiom.
  describe('sameTagHasAlert / idiomColumn self-tests', () => {
    it('accepts role after the className on the same tag', () => {
      const src = `<div className="${BORDER_TOKEN} ${BG_TOKEN} p-3" role="alert">x</div>`;
      expect(sameTagHasAlert(src, src.indexOf(BORDER_TOKEN))).toBe(true);
    });

    it('accepts role before the className on the same tag', () => {
      const src = `<div role="alert" className="${BG_TOKEN} ${BORDER_TOKEN}">x</div>`;
      expect(sameTagHasAlert(src, src.indexOf(BG_TOKEN))).toBe(true);
    });

    it('rejects role="alert" that sits on a NEIGHBORING tag a few lines up', () => {
      const src = [
        `<p role="alert">unrelated banner</p>`,
        `<div className="${BORDER_TOKEN} ${BG_TOKEN}">`,
        `  oops`,
        `</div>`,
      ].join('\n');
      expect(sameTagHasAlert(src, src.indexOf(BORDER_TOKEN))).toBe(false);
    });

    it('detects the reversed idiom (bg before border) and interleaved classes', () => {
      expect(idiomColumn(`className="${BG_TOKEN} rounded ${BORDER_TOKEN}"`)).toBeGreaterThan(-1);
      expect(idiomColumn(`className="${BORDER_TOKEN} ${BG_TOKEN}"`)).toBeGreaterThan(-1);
      expect(idiomColumn(`className="${BORDER_TOKEN} only"`)).toBe(-1);
    });
  });
});
