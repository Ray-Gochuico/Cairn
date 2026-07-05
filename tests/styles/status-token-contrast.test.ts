import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Wave-4 a11y: contrast-math lock for the semantic status tokens.
 *
 * jsdom can't assert rendered color, so this suite parses the HSL triples
 * out of src/globals.css and computes WCAG 2.x contrast ratios directly
 * (same approach as tests/styles/destructive-token-contrast.test.ts, which
 * owns the destructive-soft-foreground/tint pairs — not re-tested here).
 *
 * Pairs locked here are exactly the ones the Wave-4 token sweep depends on:
 *   1. text-{success,warning,info}-foreground and
 *      text-destructive-soft-foreground as BARE text on --background and
 *      --card (the sweep rewrites ~44 raw-token usages onto these).
 *   2. The same *-foreground tokens on their matching *-soft banner tints.
 *   3. --destructive-foreground on SOLID --destructive (the 21
 *      variant="destructive" buttons) — forces the light --destructive
 *      retune to 0 72% 45%.
 *   4. --muted-foreground on --muted (TabsList inactive labels, ui/tabs.tsx)
 *      and on --background — forces the light 46.9% → 45% nudge.
 */

const ROOT = process.cwd();
const GLOBALS = readFileSync(path.join(ROOT, 'src/globals.css'), 'utf8');

type Rgb = [number, number, number];

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
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

function block(selector: string): string {
  const re = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\}`);
  const m = GLOBALS.match(re);
  if (!m) throw new Error(`Could not find "${selector}" block in src/globals.css`);
  return m[1];
}

function hsl(body: string, token: string): Rgb {
  const re = new RegExp(`--${token}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`);
  const m = body.match(re);
  if (!m) throw new Error(`Token --${token} not found / not in "H S% L%" form`);
  return hslToRgb(parseFloat(m[1]), parseFloat(m[2]) / 100, parseFloat(m[3]) / 100);
}

const THEMES = [
  { name: 'light', body: block(':root') },
  { name: 'dark', body: block('.dark') },
] as const;

const AA_SMALL = 4.5;

function expectPair(body: string, theme: string, fg: string, bg: string) {
  const ratio = contrastRatio(hsl(body, fg), hsl(body, bg));
  expect(
    ratio,
    `${theme}: --${fg} on --${bg} was ${ratio.toFixed(2)}:1 (needs >= ${AA_SMALL}:1)`,
  ).toBeGreaterThanOrEqual(AA_SMALL);
}

describe('status *-foreground tokens are AA as bare text (sweep targets)', () => {
  const TEXT_TOKENS = [
    'success-foreground',
    'warning-foreground',
    'info-foreground',
    'destructive-soft-foreground',
  ];
  for (const { name, body } of THEMES) {
    for (const token of TEXT_TOKENS) {
      it(`${name}: ${token} on background`, () => expectPair(body, name, token, 'background'));
      it(`${name}: ${token} on card`, () => expectPair(body, name, token, 'card'));
    }
  }
});

describe('status *-foreground tokens are AA on their -soft banner tints', () => {
  for (const { name, body } of THEMES) {
    for (const status of ['success', 'warning', 'info']) {
      it(`${name}: ${status}-foreground on ${status}-soft`, () =>
        expectPair(body, name, `${status}-foreground`, `${status}-soft`));
    }
  }
});

describe('solid destructive button pair (21 variant="destructive" call sites)', () => {
  for (const { name, body } of THEMES) {
    it(`${name}: destructive-foreground on solid destructive`, () =>
      expectPair(body, name, 'destructive-foreground', 'destructive'));
  }
});

describe('muted-foreground (TabsList inactive labels, ui/tabs.tsx)', () => {
  for (const { name, body } of THEMES) {
    it(`${name}: muted-foreground on muted`, () =>
      expectPair(body, name, 'muted-foreground', 'muted'));
    it(`${name}: muted-foreground on background`, () =>
      expectPair(body, name, 'muted-foreground', 'background'));
  }
});

describe('chart stroke tokens clear the 3:1 non-text floor (WCAG 1.4.11)', () => {
  // Thin chart LINES (1.25–2.5px) — the *-stroke tokens exist because the
  // fill tokens fail as strokes (light --success 2.30:1; dark --destructive
  // 2.00:1 — round-2 B1). 3:1 is the graphical-object floor, not AA text.
  const STROKE_MIN = 3;
  const STROKE_TOKENS = ['chart-success', 'chart-danger', 'chart-warning'];
  for (const { name, body } of THEMES) {
    for (const token of STROKE_TOKENS) {
      it(`${name}: --${token} on background >= 3:1`, () => {
        const ratio = contrastRatio(hsl(body, token), hsl(body, 'background'));
        expect(
          ratio,
          `${name}: --${token} on --background was ${ratio.toFixed(2)}:1 (needs >= ${STROKE_MIN}:1)`,
        ).toBeGreaterThanOrEqual(STROKE_MIN);
      });
    }
  }
});
