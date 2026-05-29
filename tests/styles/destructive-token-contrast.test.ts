import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

/**
 * v1.1 design-review finding: the semantic-token system gives
 * --success/--warning/--info each a "-foreground" tuned to be legible as
 * TEXT on the matching "-soft" background, but --destructive only had
 * --destructive-foreground (near-white, for white text on a SOLID
 * destructive button fill). The pervasive error-pane idiom
 * `bg-destructive/10 ... text-destructive` therefore rendered the
 * --destructive DEFAULT (a desaturated maroon fill token) as text on a
 * soft tint: ~1.95:1 on dark, ~3.3:1 on light — both hard WCAG AA failures
 * (small text needs 4.5:1).
 *
 * This suite locks the fix: a dedicated "text on soft destructive" token,
 * --destructive-soft-foreground, that clears 4.5:1 on the tinted surfaces
 * in BOTH themes, plus a guard that the low-contrast idiom never returns.
 */

const ROOT = process.cwd();
const GLOBALS = readFileSync(path.join(ROOT, 'src/globals.css'), 'utf8');

// --- WCAG / color math ------------------------------------------------------

type Rgb = [number, number, number]; // each channel 0..1

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

/** Composite an opaque `fg` color over an opaque `bg` at the given alpha. */
function over(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// --- globals.css token parsing ----------------------------------------------

/** Pull the body of a CSS rule (`:root { ... }` / `.dark { ... }`). */
function block(selector: string): string {
  const re = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\}`);
  const m = GLOBALS.match(re);
  if (!m) throw new Error(`Could not find "${selector}" block in src/globals.css`);
  return m[1];
}

/** Read an `--token: H S% L%;` HSL triple from a rule body. */
function hsl(body: string, token: string): Rgb {
  const re = new RegExp(`--${token}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`);
  const m = body.match(re);
  if (!m) throw new Error(`Token --${token} not found / not in "H S% L%" form`);
  return hslToRgb(parseFloat(m[1]), parseFloat(m[2]) / 100, parseFloat(m[3]) / 100);
}

const THEMES = [
  { name: 'light', body: block(':root') },
  { name: 'dark', body: block('.dark') },
];

// Opacities the error-pane / status-badge idiom actually uses on a
// destructive tint (bg-destructive/10 for panes, /15 for import badges).
const TINTS = [0.1, 0.15];

const AA_SMALL = 4.5;

describe('--destructive-soft-foreground: text on soft destructive tint', () => {
  for (const { name, body } of THEMES) {
    const destructive = hsl(body, 'destructive');
    const background = hsl(body, 'background');

    it(`is defined for the ${name} theme`, () => {
      expect(() => hsl(body, 'destructive-soft-foreground')).not.toThrow();
    });

    for (const alpha of TINTS) {
      it(`clears WCAG AA (>=${AA_SMALL}:1) on bg-destructive/${alpha * 100} in ${name}`, () => {
        const text = hsl(body, 'destructive-soft-foreground');
        const surface = over(destructive, background, alpha);
        const ratio = contrastRatio(text, surface);
        expect(
          ratio,
          `${name} text-on-/${alpha * 100} contrast was ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_SMALL);
      });
    }

    it(`is more legible than the old text-destructive on tint in ${name}`, () => {
      const oldText = destructive; // what `text-destructive` resolved to
      const newText = hsl(body, 'destructive-soft-foreground');
      const surface = over(destructive, background, 0.1);
      expect(contrastRatio(newText, surface)).toBeGreaterThan(
        contrastRatio(oldText, surface),
      );
    });
  }
});

// --- migration guard ---------------------------------------------------------

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

/**
 * The low-contrast idiom: `text-destructive` (NOT `text-destructive-foreground`,
 * NOT the migrated `text-destructive-soft-foreground`) on a soft destructive
 * tint (`bg-destructive/{10,15,20}`) in the same className. Solid fills
 * (`bg-destructive` / `bg-destructive/90` + `text-destructive-foreground`) are
 * intentionally excluded.
 */
const TINT_RE = /bg-destructive\/(?:10|15|20)\b/;
const BAD_TEXT_RE = /\btext-destructive\b(?!-)/;

describe('no low-contrast destructive-text-on-tint idiom remains in src/', () => {
  it('has zero text-destructive on a soft destructive tint', () => {
    const violations: string[] = [];
    for (const file of walk(path.join(ROOT, 'src'))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (TINT_RE.test(line) && BAD_TEXT_RE.test(line)) {
          violations.push(`${path.relative(ROOT, file)}:${i + 1}`);
        }
      });
    }
    expect(
      violations,
      `Use text-destructive-soft-foreground on soft tints. Offenders:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
