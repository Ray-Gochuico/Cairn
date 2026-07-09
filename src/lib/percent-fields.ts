/**
 * The form-boundary percent↔fraction pair, extracted from PersonForm (the
 * house prior art) so every rate field shares one conversion. Storage is
 * ALWAYS the fraction (0..1); the FORM field is the friendly percent (0..100).
 * toFixed(10) + parseFloat strips JS float noise (0.10 * 100 →
 * 10.000000000000002).
 */
export const fractionToPercent = (fraction: number): number =>
  parseFloat((fraction * 100).toFixed(10));

export const percentToFraction = (percent: number): number =>
  parseFloat((percent / 100).toFixed(10));
