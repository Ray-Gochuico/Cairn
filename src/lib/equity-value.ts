export interface GrantInput {
  grantDate: string;
  strikePrice: number;
  totalShares: number;
  currentFmv: number;
  vestingSchedule: { date: string; cumulativePct: number }[];
}

export interface EquityValueResult {
  vestedShares: number;
  unvestedShares: number;
  vestedValue: number;
  unvestedValue: number;
  monthlyCost: number;
  upcomingVestDates: string[];
}

export function computeEquityValue(grant: GrantInput, today: Date): EquityValueResult {
  const todayIso = today.toISOString().slice(0, 10);
  let vestedPct = 0;
  for (const entry of grant.vestingSchedule) {
    if (entry.date <= todayIso) vestedPct = entry.cumulativePct;
    else break;
  }
  const vestedShares = grant.totalShares * vestedPct;
  const unvestedShares = grant.totalShares - vestedShares;
  const vestedValue = vestedShares * grant.currentFmv;
  const unvestedValue = unvestedShares * grant.currentFmv;

  const grantDate = new Date(grant.grantDate + 'T00:00:00Z');
  const lastDate = new Date(
    grant.vestingSchedule[grant.vestingSchedule.length - 1].date + 'T00:00:00Z'
  );
  const vestingDurationMonths = Math.max(
    1,
    Math.round(
      (lastDate.getUTCFullYear() - grantDate.getUTCFullYear()) * 12 +
        (lastDate.getUTCMonth() - grantDate.getUTCMonth())
    )
  );
  const monthlyCost = (grant.strikePrice * grant.totalShares) / vestingDurationMonths;

  const upcomingVestDates = grant.vestingSchedule
    .filter((e) => e.date > todayIso)
    .slice(0, 3)
    .map((e) => e.date);

  return {
    vestedShares,
    unvestedShares,
    vestedValue,
    unvestedValue,
    monthlyCost,
    upcomingVestDates,
  };
}

/**
 * Rough per-share FMV from a private-company snapshot.
 *
 * Formula: (companyValuation − totalDebt) ÷ outstandingShares.
 *
 * Returns null when any input is null or outstandingShares is non-positive
 * (the form should disable "Use this value" in that state). When
 * totalDebt > companyValuation the numerator clamps to 0 and the result
 * includes warning='OVER_LEVERAGED' so the UI can surface "over-leveraged".
 * Debt exactly equal to valuation returns { value: 0, warning: null } —
 * that's a degenerate-but-valid wipe-out, not an over-leveraged state.
 */
export function computeFmvFromCompanyValuation(
  companyValuation: number | null,
  totalDebt: number | null,
  outstandingShares: number | null,
): { value: number; warning: 'OVER_LEVERAGED' | null } | null {
  if (companyValuation == null) return null;
  if (totalDebt == null) return null;
  if (outstandingShares == null) return null;
  if (outstandingShares <= 0) return null;

  const equityValue = companyValuation - totalDebt;
  if (equityValue < 0) {
    return { value: 0, warning: 'OVER_LEVERAGED' };
  }
  return { value: equityValue / outstandingShares, warning: null };
}
