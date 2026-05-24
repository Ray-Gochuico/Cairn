/**
 * Shade a hex color by stepping lightness ±8% in HSL space.
 * `index=0` returns the base color; subsequent indices alternate
 * darker/brighter so adjacent industry wedges stay distinguishable.
 *
 * Used by the SectorDonut industry-drill view: a single sector color
 * (e.g. Technology blue) becomes a family of shades, one per industry.
 * Lightness is clamped to [15, 85] so wedges never bottom out to black
 * or white, keeping them readable against the card background.
 */
export function shadeHexColor(hex: string, index: number): string {
  const { h, s, l } = hexToHsl(hex);
  const step = 8;
  const direction = (index % 2 === 1) ? -1 : 1;
  const magnitude = Math.floor((index + 1) / 2) * step;
  const newL = Math.max(15, Math.min(85, l + direction * magnitude));
  return hslToHex(h, s, newL);
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d) + (g < b ? 6 : 0); break;
      case g: h = ((b - r) / d) + 2; break;
      case b: h = ((r - g) / d) + 4; break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))
      .toString(16)
      .padStart(2, '0');
  return `#${f(0)}${f(8)}${f(4)}`;
}
