/**
 * Wave B (D-B5): the transactions-derived per-person expense HINT — shown as
 * one muted line under the bar's Monthly-expenses field in person scope,
 * never used as the default (coverage-dependent numbers that drift month to
 * month are the opposite of calm). Average attributed net spend over the
 * last 90 days ÷ 3; unattributed (null personId) rows are excluded — the
 * D-B4 one-rule-for-NULL-attribution. null = no hint (never a fabricated $0).
 * Transaction sign convention: positive = purchase, negative = payment/credit.
 */
export function personMonthlyExpenseHint(
  transactions: ReadonlyArray<{ date: string; amount: number; personId: number | null }>,
  personId: number,
  todayIso: string,
): number | null {
  const start = new Date(`${todayIso}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 90);
  const isoStart = start.toISOString().slice(0, 10);
  const rows = transactions.filter(
    (t) => t.personId === personId && t.date >= isoStart && t.date <= todayIso,
  );
  if (rows.length === 0) return null;
  const net = rows.reduce((s, t) => s + t.amount, 0);
  return net > 0 ? Math.round(net / 3) : null;
}
