import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Trailhead Stone (Wave 12) token contract. Locks the blaze accent family,
 * the warm-neutral discipline (sepia guard), border visibility on the new
 * grounds, and blaze-vs-amber separability. Thresholds mirror the existing
 * suites (4.5 text / 3.0 non-text) — never weaken them.
 *
 * Helpers ported verbatim from tests/styles/status-token-contrast.test.ts
 * (HSL parse → WCAG math) and tests/components/charts/palette.test.ts
 * (Machado sev-1 CVD matrices — test-only, never ships in src/).
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

function toHex([r, g, b]: Rgb): string {
  const to = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// --- Machado-2009 severity-1 CVD simulation (test-only; ported from
// tests/components/charts/palette.test.ts — NEVER ships in src/). Three
// dichromacy matrices + weighted-RGB ("redmean") distance; cvdDistance(a,b)
// returns the MIN distance over the three sims (worst-case confusability).
const CVD_MATRICES = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const;
const rgb255 = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const simulate = (m: readonly (readonly number[])[], [r, g, b]: number[]) =>
  m.map((row) => Math.max(0, Math.min(255, row[0] * r + row[1] * g + row[2] * b)));
function redmean([r1, g1, b1]: number[], [r2, g2, b2]: number[]): number {
  const rm = (r1 + r2) / 2,
    dr = r1 - r2,
    dg = g1 - g2,
    db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
function cvdDistance(a: string, b: string): number {
  const A = rgb255(a),
    B = rgb255(b);
  return Math.min(
    ...(['protan', 'deutan', 'tritan'] as const).map((k) =>
      redmean(simulate(CVD_MATRICES[k], A), simulate(CVD_MATRICES[k], B)),
    ),
  );
}

const THEMES = [
  { name: 'light', body: block(':root') },
  { name: 'dark', body: block('.dark') },
] as const;

describe('blaze accent family', () => {
  for (const { name, body } of THEMES) {
    it(`${name}: --blaze is defined and clears 3:1 as a stroke/mark on background and card`, () => {
      // light 4.59 / 4.83; dark 6.29 / 5.76
      expect(contrastRatio(hsl(body, 'blaze'), hsl(body, 'background'))).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(hsl(body, 'blaze'), hsl(body, 'card'))).toBeGreaterThanOrEqual(3);
    });
    it(`${name}: --primary is AA as bare text on background, card, and the muted wash`, () => {
      // light 5.36 / 5.63 / 4.95; dark 6.29 / 5.76 / 4.90 — text-primary is a
      // text idiom app-wide and lands on hover/muted washes (D3: the fill hex
      // #B4531F is 4.25:1 on the light wash — this pair is WHY --primary is
      // the text-safe hex and --blaze exists).
      expect(contrastRatio(hsl(body, 'primary'), hsl(body, 'background'))).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(hsl(body, 'primary'), hsl(body, 'card'))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(hsl(body, 'primary'), hsl(body, 'muted'))).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: --primary-foreground is AA on solid --primary`, () => {
      // light 5.63; dark 5.90
      expect(
        contrastRatio(hsl(body, 'primary-foreground'), hsl(body, 'primary')),
      ).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: --ring clears the 3:1 focus-indicator floor on background`, () => {
      expect(contrastRatio(hsl(body, 'ring'), hsl(body, 'background'))).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('border visibility on the stone grounds (spec risk: dark borders vanishing)', () => {
  // Floors are set just under the recomputed values so future token drift
  // that re-fades borders fails loudly. light: 1.19 ground / 1.25 card;
  // dark (post-D6 #3A332A): 1.49 ground / 1.36 card (old dark pair was 1.37).
  const FLOORS = {
    light: { background: 1.15, card: 1.2 },
    dark: { background: 1.4, card: 1.3 },
  } as const;
  for (const { name, body } of THEMES) {
    for (const bg of ['background', 'card'] as const) {
      it(`${name}: --border vs --${bg} >= ${FLOORS[name][bg]}`, () => {
        const ratio = contrastRatio(hsl(body, 'border'), hsl(body, bg));
        expect(
          ratio,
          `${name}: --border on --${bg} was ${ratio.toFixed(2)}:1 (floor ${FLOORS[name][bg]})`,
        ).toBeGreaterThanOrEqual(FLOORS[name][bg]);
      });
    }
  }
});

describe('warm-neutral discipline (sepia guard: hue band + chroma ceiling)', () => {
  // The stone family must stay STONE — warm but desaturated. Hue in [30, 48]
  // and RGB channel spread <= 18/255 (~7% — the spec's "saturation <= ~8%"
  // expressed in the round-trip-stable metric). Actual spreads: light
  // bg 6 / card 4 / muted 11 / border 14; dark bg 7 / card 9 / muted 13 / border 16.
  const NEUTRALS = [
    'background',
    'card',
    'popover',
    'muted',
    'secondary',
    'accent',
    'border',
    'input',
  ] as const;
  for (const { name, body } of THEMES) {
    for (const token of NEUTRALS) {
      it(`${name}: --${token} stays in the stone band (hue 30-48, spread <= 18/255)`, () => {
        const [h] = hslTriple(body, token);
        expect(h, `${name}: --${token} hue ${h}`).toBeGreaterThanOrEqual(30);
        expect(h, `${name}: --${token} hue ${h}`).toBeLessThanOrEqual(48);
        const rgb = hsl(body, token).map((v) => v * 255);
        const spread = Math.max(...rgb) - Math.min(...rgb);
        expect(spread, `${name}: --${token} channel spread ${spread.toFixed(1)}`).toBeLessThanOrEqual(
          18,
        );
      });
    }
  }
});

describe('blaze vs the warning-amber family (Monthly banner / pending-dot adjacency)', () => {
  // Machado sev-1 min-CVD distance >= 40 = clearly separable under all three
  // dichromacies (same bar as WEDGE_PALETTE adjacency). Actual: light
  // blaze-vs-warning 158, blaze-vs-chart-warning 60; dark 50 and 122.
  for (const { name, body } of THEMES) {
    for (const amber of ['warning', 'chart-warning'] as const) {
      it(`${name}: --blaze vs --${amber} min-CVD >= 40`, () => {
        const d = cvdDistance(toHex(hsl(body, 'blaze')), toHex(hsl(body, amber)));
        expect(d, `${name}: --blaze vs --${amber} min-CVD ${d.toFixed(0)}`).toBeGreaterThanOrEqual(
          40,
        );
      });
    }
  }
});

describe('radius', () => {
  it('is 0.375rem (Trailhead Stone)', () => {
    expect(block(':root')).toMatch(/--radius:\s*0\.375rem/);
  });
});
