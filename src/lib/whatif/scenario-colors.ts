export const BASELINE_COLOR = '#4f86f7';

export const NON_BASELINE_PALETTE = [
  '#a8c0fb',
  '#ef8b5a',
  '#5fbb7c',
  '#c87bd9',
  '#e6b54b',
  '#6cc5d6',
] as const;

export function defaultScenarioColor(sortOrder: number, isBaseline: boolean): string {
  if (isBaseline) return BASELINE_COLOR;
  const idx = ((sortOrder % NON_BASELINE_PALETTE.length) + NON_BASELINE_PALETTE.length) % NON_BASELINE_PALETTE.length;
  return NON_BASELINE_PALETTE[idx];
}
