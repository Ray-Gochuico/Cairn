import { describe, it, expect } from 'vitest';
import {
  CHART_PALETTE,
  LEGACY_TAILWIND_PALETTE,
  SWATCH_OPTIONS,
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
