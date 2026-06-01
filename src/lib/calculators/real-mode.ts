/** Deflate a nominal future value to today's purchasing power. */
export function toRealValue(nominal: number, inflation: number, yearsFromNow: number): number {
  return nominal / Math.pow(1 + inflation, yearsFromNow);
}

/**
 * Deflate the chosen numeric keys of each chart-data point by that point's own
 * elapsed-years (read from `yearKey`), NOT by array index and NOT by the x-axis
 * label (CompoundInterest's xKey is the string "Year N"). Non-value keys
 * (labels, the target line, the year field) pass through untouched.
 */
export function toRealSeries<T extends Record<string, number | string>>(
  points: T[],
  inflation: number,
  opts: { valueKeys: string[]; yearKey: string },
): T[] {
  return points.map((p) => {
    const years = Number(p[opts.yearKey]);
    const out: Record<string, number | string> = { ...p };
    for (const k of opts.valueKeys) {
      const v = p[k];
      if (typeof v === 'number') out[k] = toRealValue(v, inflation, years);
    }
    return out as T;
  });
}
