import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Wave 15 T8: the PaycheckCalculator swatch/donut family. Replaces the frozen
 * slate/sky/green hex ramp — #86efac was 1.36:1 on the stone light card
 * (UNDER the 1.45 wedge floor) and #7dd3fc sat at ~1.6:1 with no margin.
 * The family is THEME-STATIC (defined once in :root — D8): every value lives
 * in the luminance band that clears the floor against BOTH theme cards.
 *
 * Helpers ported verbatim from tests/styles/stone-token-contrast.test.ts
 * (HSL parse → WCAG math); the CVD block is not needed here.
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

function hslTriple(body: string, token: string): [number, number, number] {
  const re = new RegExp(`--${token}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`);
  const m = body.match(re);
  if (!m) throw new Error(`Token --${token} not found / not in "H S% L%" form`);
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
}

function hsl(body: string, token: string): Rgb {
  const [h, s, l] = hslTriple(body, token);
  return hslToRgb(h, s / 100, l / 100);
}

const TOKENS = [
  'paycheck-gross',
  'paycheck-federal',
  'paycheck-ss',
  'paycheck-state',
  'paycheck-city',
  'paycheck-pretax',
] as const;

const root = block(':root');
const dark = block('.dark');

describe('paycheck swatch tokens clear the 1.45:1 wedge floor on both cards', () => {
  for (const { name, body } of [
    { name: 'light', body: root },
    { name: 'dark', body: dark },
  ]) {
    const card = hsl(body, 'card');
    for (const token of TOKENS) {
      it(`${name}: --${token} >= 1.45 vs --card`, () => {
        // recorded margins (light/dark): gross 2.5/6.3, federal 8.0/2.0,
        // ss 4.7/3.5, state 5.1/3.2, city 2.6/6.3, pretax 6.5/2.5
        const swatch = hsl(root, token); // theme-static family: always :root
        expect(contrastRatio(swatch, card)).toBeGreaterThanOrEqual(1.45);
      });
    }
  }
});

describe('the two greens stay separable (pretax wedge vs --success take-home wedge)', () => {
  for (const { name, body } of [
    { name: 'light', body: root },
    { name: 'dark', body: dark },
  ]) {
    it(`${name}: --paycheck-pretax vs --success >= 2:1`, () => {
      // recorded ~2.96 both themes — the reason pretax cannot bind
      // --chart-success (dark --chart-success === dark --success).
      const pretax = hsl(root, 'paycheck-pretax');
      const success = hsl(body, 'success');
      expect(contrastRatio(pretax, success)).toBeGreaterThanOrEqual(2);
    });
  }
});

describe('no raw hex left in the calculator components', () => {
  it('PaycheckCalculator.tsx carries zero 6-digit hex literals', () => {
    const src = readFileSync(
      path.join(ROOT, 'src/pages/calculators/PaycheckCalculator.tsx'),
      'utf8',
    );
    expect(src.match(/#[0-9a-fA-F]{6}\b/g) ?? []).toEqual([]);
  });
});
