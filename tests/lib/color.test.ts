import { describe, it, expect } from 'vitest';
import { shadeHexColor } from '@/lib/color';

function hexLightness(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return ((Math.max(r, g, b) + Math.min(r, g, b)) / 2) * 100;
}

describe('shadeHexColor', () => {
  it('index 0 returns the base color (round-trip stable to ±2 lightness units)', () => {
    const base = '#3b82f6';
    const result = shadeHexColor(base, 0);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
    expect(Math.abs(hexLightness(result) - hexLightness(base))).toBeLessThan(2);
  });

  it('index 1 produces a darker shade than the base', () => {
    const base = '#3b82f6';
    expect(hexLightness(shadeHexColor(base, 1))).toBeLessThan(hexLightness(base));
  });

  it('index 2 produces a brighter shade than the base', () => {
    const base = '#3b82f6';
    expect(hexLightness(shadeHexColor(base, 2))).toBeGreaterThan(hexLightness(base));
  });

  it('successive odd indices step progressively darker', () => {
    const base = '#3b82f6';
    expect(hexLightness(shadeHexColor(base, 3))).toBeLessThan(hexLightness(shadeHexColor(base, 1)));
  });

  it('successive even indices step progressively brighter', () => {
    const base = '#3b82f6';
    expect(hexLightness(shadeHexColor(base, 4))).toBeGreaterThan(hexLightness(shadeHexColor(base, 2)));
  });

  it('clamps lightness so extremes never bottom out to black or white', () => {
    // Lightness is clamped at [15, 85] in HSL space; allow ±1 unit slack
    // for hex round-trip rounding.
    const tooBright = shadeHexColor('#3b82f6', 20);
    expect(hexLightness(tooBright)).toBeLessThanOrEqual(86);
    const tooDark = shadeHexColor('#3b82f6', 21);
    expect(hexLightness(tooDark)).toBeGreaterThanOrEqual(14);
  });

  it('returns the same hex shape for grayscale inputs', () => {
    expect(shadeHexColor('#94a3b8', 1)).toMatch(/^#[0-9a-f]{6}$/);
    expect(shadeHexColor('#94a3b8', 2)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
