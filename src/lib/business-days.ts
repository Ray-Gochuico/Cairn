/** YYYY-MM string → YYYY-MM-DD of the last business day (Mon–Fri) of that month. */
export function lastBusinessDayOfMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this month
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

/** Inclusive range of YYYY-MM strings between two months. */
export function monthsBetween(fromYyyymm: string, toYyyymm: string): string[] {
  const [yf, mf] = fromYyyymm.split('-').map(Number);
  const [yt, mt] = toYyyymm.split('-').map(Number);
  const result: string[] = [];
  let y = yf;
  let m = mf;
  while (y < yt || (y === yt && m <= mt)) {
    result.push(`${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}`);
    m++;
    if (m === 13) { m = 1; y++; }
  }
  return result;
}
