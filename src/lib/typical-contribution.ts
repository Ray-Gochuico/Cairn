/**
 * D4: the allocator's contribution prefill — rolling-12-month contribution
 * sum ÷ 12, rounded to the dollar. SAME window as the FI card's
 * annualContribution prefill (÷ 12), so the two cards' derived figures
 * agree for the same user. null (blank field) when there is no history —
 * never a fabricated demo number.
 */
export function typicalMonthlyContribution(
  contributions: ReadonlyArray<{ date: string; amount: number }>,
  todayIso: string,
): number | null {
  const yearAgo = new Date(`${todayIso}T00:00:00Z`);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const isoYearAgo = yearAgo.toISOString().slice(0, 10);
  const sum = contributions
    .filter((c) => c.date >= isoYearAgo && c.date <= todayIso)
    .reduce((s, c) => s + c.amount, 0);
  return sum > 0 ? Math.round(sum / 12) : null;
}
