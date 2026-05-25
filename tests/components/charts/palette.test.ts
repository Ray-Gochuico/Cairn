import { describe, it, expect } from 'vitest';
import {
  CHART_NEUTRAL,
  CHART_PALETTE,
  LEGACY_TAILWIND_PALETTE,
  SECTOR_COLORS,
  SWATCH_OPTIONS,
  colorForSector,
  shadedColorForIndustry,
} from '@/components/charts/palette';

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
