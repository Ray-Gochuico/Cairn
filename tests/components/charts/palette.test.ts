import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  CHART_NEUTRAL,
  CHART_PALETTE,
  LEGACY_TAILWIND_PALETTE,
  SECTOR_COLORS,
  SWATCH_OPTIONS,
  WEDGE_PALETTE,
  colorForSector,
  paletteColorAt,
  shadedColorForIndustry,
} from '@/components/charts/palette';
import { relativeLuminance, contrastRatio } from '@/lib/color';

// --- --card background readers (ported from destructive-token-contrast.test.ts) ---
// Read the two real --card HSL triples from globals.css so these guards
// auto-track any theme change instead of hard-coding hexes.
function hslToHex(h: number, s: number, l: number): string {
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
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
const GLOBALS = readFileSync(path.join(process.cwd(), 'src/globals.css'), 'utf8');
function cardHex(selector: string): string {
  const body = GLOBALS.match(
    new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\}`),
  )![1];
  const m = body.match(/--card:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/)!;
  return hslToHex(parseFloat(m[1]), parseFloat(m[2]) / 100, parseFloat(m[3]) / 100);
}
const CARD_LIGHT = cardHex(':root'); // #ffffff
const CARD_DARK = cardHex('.dark');

// --- Machado-2009 severity-1 CVD simulation (test-only; the REAL check, not a
// hue-family proxy). Three dichromacy matrices + weighted-RGB ("redmean")
// distance. cvdDistance(a,b) returns the MIN distance over the three sims — the
// worst-case confusability. Reused by the Commodities-anchored sector check.
// NEVER ships in src/. Mirrors Appendix A table 3.
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

describe('palette', () => {
  it('CHART_PALETTE still holds 20 colors', () => {
    expect(CHART_PALETTE).toHaveLength(20);
  });

  it('LEGACY_TAILWIND_PALETTE holds the 10 Tailwind-600 hexes', () => {
    expect(LEGACY_TAILWIND_PALETTE).toEqual([
      '#2563eb', '#ea580c', '#16a34a', '#dc2626', '#9333ea',
      '#0891b2', '#db2777', '#ca8a04', '#0d9488', '#7c3aed',
    ]);
  });

  it('SWATCH_OPTIONS is the 30 swatches — CHART_PALETTE then legacy', () => {
    expect(SWATCH_OPTIONS).toHaveLength(30);
    expect(SWATCH_OPTIONS.slice(0, 20)).toEqual(CHART_PALETTE);
    expect(SWATCH_OPTIONS.slice(20)).toEqual(LEGACY_TAILWIND_PALETTE);
  });

  it('every swatch is a 6-digit hex string', () => {
    for (const hex of SWATCH_OPTIONS) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('SECTOR_COLORS', () => {
  it('covers the 11 Morningstar/Yahoo sectors plus pseudo-sectors and Misc', () => {
    // Keys mirror Yahoo's exact labels — see palette.ts for why this matters.
    expect(Object.keys(SECTOR_COLORS)).toEqual([
      'Technology',
      'Financial Services',
      'Healthcare',
      'Consumer Cyclical',
      'Communication Services',
      'Industrials',
      'Consumer Defensive',
      'Energy',
      'Utilities',
      'Basic Materials',
      'Real Estate',
      'Fixed Income',
      'Commodities',
      'Crypto',
      'Unclassified',
      'Misc',
    ]);
  });

  it('every named sector (not Unclassified/Misc) has a distinct hex', () => {
    // Unclassified and Misc deliberately share the neutral gray; the 14
    // named sectors should all be visually distinct.
    const named = Object.entries(SECTOR_COLORS)
      .filter(([k]) => k !== 'Unclassified' && k !== 'Misc')
      .map(([, hex]) => hex);
    expect(new Set(named).size).toBe(named.length);
  });

  it('every sector color is a 6-digit hex', () => {
    for (const hex of Object.values(SECTOR_COLORS)) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('Unclassified and Misc reuse the neutral gray', () => {
    expect(SECTOR_COLORS.Unclassified).toBe(CHART_NEUTRAL);
    expect(SECTOR_COLORS.Misc).toBe(CHART_NEUTRAL);
  });
});

describe('SECTOR_COLORS contrast', () => {
  it('every sector color sits in the luminance band and clears >=1.45:1 on both --card backgrounds', () => {
    for (const [name, hex] of Object.entries(SECTOR_COLORS)) {
      const L = relativeLuminance(hex);
      expect(L, `${name} ${hex} lum ${L.toFixed(3)}`).toBeGreaterThanOrEqual(0.08);
      expect(L, `${name} ${hex} lum ${L.toFixed(3)}`).toBeLessThanOrEqual(0.92);
      expect(contrastRatio(hex, CARD_LIGHT), `${name} vs light`).toBeGreaterThanOrEqual(1.45);
      expect(contrastRatio(hex, CARD_DARK), `${name} vs dark`).toBeGreaterThanOrEqual(1.45);
    }
  });
  it('no sector color is near-white (>1.6:1 vs #fff) — guards the Commodities regression', () => {
    for (const [name, hex] of Object.entries(SECTOR_COLORS)) {
      expect(contrastRatio(hex, '#ffffff'), `${name} ${hex}`).toBeGreaterThan(1.6);
    }
  });
});

describe('SECTOR_COLORS CVD distinguishability (Commodities-anchored)', () => {
  // SCOPED ON PURPOSE to Commodities. A blanket all-pairs >=40 assertion would
  // FAIL on a PRE-EXISTING, out-of-scope pair: Technology #3b82f6 vs Real Estate
  // #a855f7 are min-CVD ~4 (blue/purple collapse under protan+deutan) — a known
  // limitation of the hand-tuned sector ramp that this palette plan does NOT
  // re-derive (see OD4). The regression THIS plan must prevent is the
  // Commodities/Energy near-collision, so we anchor the guard on Commodities:
  // it must stay clearly separable from EVERY other named sector under all three
  // dichromacies. (#a16207 worst case = 71 vs Energy; was 26 with the rejected
  // #ca8a04.) Unclassified/Misc are intentionally neutral gray and excluded.
  it('Commodities is CVD-distinguishable (min Machado-sev1 distance >= 40) from every other named sector', () => {
    const commodities = SECTOR_COLORS['Commodities'];
    for (const [name, hex] of Object.entries(SECTOR_COLORS)) {
      if (name === 'Commodities' || name === 'Unclassified' || name === 'Misc') continue;
      const d = cvdDistance(commodities, hex);
      expect(
        d,
        `Commodities ${commodities} vs ${name} ${hex}: min-CVD ${d.toFixed(0)}`,
      ).toBeGreaterThanOrEqual(40);
    }
  });
});

describe('colorForSector', () => {
  it('returns the mapped hex for a known sector', () => {
    expect(colorForSector('Technology')).toBe(SECTOR_COLORS.Technology);
  });

  it('falls back to CHART_NEUTRAL for an unknown sector', () => {
    expect(colorForSector('Unknown')).toBe(CHART_NEUTRAL);
    expect(colorForSector('')).toBe(CHART_NEUTRAL);
  });
});

describe('shadedColorForIndustry', () => {
  it('returns 4 distinct hexes for the first 4 industries of a sector', () => {
    const shades = [0, 1, 2, 3].map((i) => shadedColorForIndustry('Technology', i));
    expect(new Set(shades).size).toBe(4);
  });

  it('uses the sector base color for index 0 (within rounding tolerance)', () => {
    expect(shadedColorForIndustry('Technology', 0)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('falls back to neutral shades for an unknown parent sector', () => {
    const shades = [0, 1, 2].map((i) => shadedColorForIndustry('Unknown', i));
    for (const s of shades) expect(s).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(shades).size).toBe(3);
  });
});

describe('WEDGE_PALETTE', () => {
  // NOTE: the band / contrast / near-white assertions below pass BY CONSTRUCTION
  // over the hand-picked palette — they cannot fail against today's values.
  // They are a GUARDRAIL that protects FUTURE edits to WEDGE_PALETTE. Their teeth
  // were proven once via a temp `#fafafa` probe (luminance ~0.96, contrast ~1.04
  // vs white — trips BOTH the upper band bound and the >1.6 near-white guard),
  // red then reverted to green. Do not treat their green as a "result"; it's a
  // contract.
  it('has 10 colors, all 6-digit hex', () => {
    expect(WEDGE_PALETTE).toHaveLength(10);
    for (const c of WEDGE_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it('every entry sits inside the luminance band [0.08, 0.92] (no near-white / near-black)', () => {
    for (const c of WEDGE_PALETTE) {
      const L = relativeLuminance(c);
      expect(L, `${c} luminance ${L.toFixed(3)}`).toBeGreaterThanOrEqual(0.08);
      expect(L, `${c} luminance ${L.toFixed(3)}`).toBeLessThanOrEqual(0.92);
    }
  });
  it('every entry clears the not-invisible floor (>=1.45:1) vs BOTH --card backgrounds', () => {
    for (const c of WEDGE_PALETTE) {
      expect(contrastRatio(c, CARD_LIGHT), `${c} vs light`).toBeGreaterThanOrEqual(1.45);
      expect(contrastRatio(c, CARD_DARK), `${c} vs dark`).toBeGreaterThanOrEqual(1.45);
    }
  });
  it('contains no near-white color (the I9 defect): none within 1.6:1 of white', () => {
    for (const c of WEDGE_PALETTE) {
      expect(contrastRatio(c, '#ffffff'), `${c}`).toBeGreaterThan(1.6);
    }
  });
  it('all entries are distinct', () => {
    expect(new Set(WEDGE_PALETTE).size).toBe(WEDGE_PALETTE.length);
  });
  // REAL CVD guard (not a hue-family proxy): adjacent-in-assignment-order entries
  // get the largest neighbouring wedges, so they must be the most separated.
  // >40 ≈ "safe" under the worst of the three dichromacies (Appendix A table 3).
  it('adjacent WEDGE_PALETTE entries stay CVD-distinguishable (min Machado-sev1 distance >= 40)', () => {
    for (let i = 0; i < WEDGE_PALETTE.length - 1; i++) {
      const d = cvdDistance(WEDGE_PALETTE[i], WEDGE_PALETTE[i + 1]);
      expect(
        d,
        `idx ${i} ${WEDGE_PALETTE[i]} vs ${i + 1} ${WEDGE_PALETTE[i + 1]}: min-CVD ${d.toFixed(0)}`,
      ).toBeGreaterThanOrEqual(40);
    }
  });
});

describe('paletteColorAt', () => {
  it('returns WEDGE_PALETTE[i] for i in range', () => {
    expect(paletteColorAt(0)).toBe(WEDGE_PALETTE[0]);
    expect(paletteColorAt(3)).toBe(WEDGE_PALETTE[3]);
  });
  it('wraps modulo the palette length', () => {
    expect(paletteColorAt(WEDGE_PALETTE.length)).toBe(WEDGE_PALETTE[0]);
    expect(paletteColorAt(WEDGE_PALETTE.length + 2)).toBe(WEDGE_PALETTE[2]);
  });
  it('handles negative and non-integer indices without throwing or returning undefined', () => {
    expect(paletteColorAt(-1)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(paletteColorAt(2.7)).toMatch(/^#[0-9a-f]{6}$/i);
  });
  // LOAD-BEARING guard for the I9 fix: the >=11-entity VISUAL smoke is
  // best-effort (Plan C's seed yields ~7 underlyings, below WEDGE_PALETTE length
  // 10, so the donut may never exercise the wrap). THIS unit test is the
  // guarantee that the wrap path (paletteColorAt for indices well past the
  // palette length) can never produce a near-white wedge — covers i = -3..40,
  // i.e. multiple full wraps.
  it('never returns a near-white color regardless of index (load-bearing wrap guard)', () => {
    for (let i = -3; i < 40; i++) {
      expect(
        contrastRatio(paletteColorAt(i), '#ffffff'),
        `paletteColorAt(${i})`,
      ).toBeGreaterThan(1.6);
    }
  });
});

// Guard the existing length contract is untouched by this change.
describe('CHART_PALETTE unchanged by WEDGE_PALETTE addition', () => {
  it('still holds 20 colors (fixed-index consumers depend on this)', () => {
    expect(CHART_PALETTE).toHaveLength(20);
    expect(CHART_PALETTE[0]).toBe('#4c78a8'); // BacktestChart + ProjectionChart depend on idx 0
  });
});
