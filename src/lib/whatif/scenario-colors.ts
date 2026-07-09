export const BASELINE_COLOR = '#4f86f7';

// W10 design: the first alternate must contrast the blue baseline (#4f86f7),
// so it leads with the hue-opposed orange; the near-baseline pale blue
// (#a8c0fb) — nearly indistinguishable from baseline — seeds LAST.
export const NON_BASELINE_PALETTE = [
  '#ef8b5a',
  '#5fbb7c',
  '#c87bd9',
  '#e6b54b',
  '#6cc5d6',
  '#a8c0fb',
] as const;

export function defaultScenarioColor(sortOrder: number, isBaseline: boolean): string {
  if (isBaseline) return BASELINE_COLOR;
  const idx = ((sortOrder % NON_BASELINE_PALETTE.length) + NON_BASELINE_PALETTE.length) % NON_BASELINE_PALETTE.length;
  return NON_BASELINE_PALETTE[idx];
}
