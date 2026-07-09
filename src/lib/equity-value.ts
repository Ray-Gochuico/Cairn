import { GrantType } from '@/types/enums';

export interface GrantInput {
  grantDate: string;
  strikePrice: number;
  totalShares: number;
  currentFmv: number;
  grantType: GrantType;
  vestingSchedule: { date: string; cumulativePct: number }[];
}

/**
 * Wave-9 M64: holder value per share. Options (NSO/ISO) are worth the spread
 * above strike — an underwater option is worth $0, not its full FMV. RSUs
 * (strike 0) are worth full FMV. (Ordinary-income-at-vest treatment differs —
 * see grantOrdinaryIncomeOnVest — but HOLDER VALUE nets the strike for both
 * option types.)
 */
function perShareHolderValue(
  grant: Pick<GrantInput, 'grantType' | 'currentFmv' | 'strikePrice'>,
): number {
  return grant.grantType === GrantType.NSO || grant.grantType === GrantType.ISO
    ? Math.max(0, grant.currentFmv - grant.strikePrice)
    : grant.currentFmv;
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
  const perShare = perShareHolderValue(grant); // wave-9 M64
  const vestedValue = vestedShares * perShare;
  const unvestedValue = unvestedShares * perShare;

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
  // Wave-9 F9: a fully-vested grant has no remaining strike outlay — the
  // vesting-period average is only meaningful while vesting is in flight.
  const lastVestDate = grant.vestingSchedule[grant.vestingSchedule.length - 1].date;
  const monthlyCost =
    todayIso >= lastVestDate ? 0 : (grant.strikePrice * grant.totalShares) / vestingDurationMonths;

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

export type VestingChartPoint = { date: string; vestedValue: number };

export function vestingChartData(
  grants: ReadonlyArray<GrantInput>,
): VestingChartPoint[] {
  const dates = [
    ...new Set(grants.flatMap((g) => g.vestingSchedule.map((v) => v.date))),
  ].sort();
  return dates.map((date) => ({
    date,
    vestedValue: grants.reduce((sum, g) => {
      // last cumulativePct whose vest date <= this date (0 before the first vest)
      const pct = g.vestingSchedule.reduce(
        (acc, v) => (v.date <= date ? v.cumulativePct : acc),
        0,
      );
      return sum + pct * g.totalShares * perShareHolderValue(g); // wave-9 M64
    }, 0),
  }));
}

/**
 * Estimated ordinary income if the unvested portion of a grant vested today at
 * the current FMV.
 *
 * - RSU: unvestedShares × currentFmv  (strike price is 0; full FMV is income)
 * - NSO: unvestedShares × max(0, currentFmv − strikePrice)  (spread above strike)
 * - ISO: 0  (bargain element is an AMT preference item, not ordinary income)
 *
 * Framed as an estimate — does NOT compute withheld tax or payroll/FICA impact.
 *
 * EquityGrant objects (which carry all GrantInput fields incl. grantType)
 * satisfy `GrantInput` directly — no cast.
 */
export function grantOrdinaryIncomeOnVest(
  grant: GrantInput,
  today: Date,
): number {
  const { unvestedShares } = computeEquityValue(grant, today);
  if (grant.grantType === GrantType.ISO) return 0; // AMT preference, not ordinary income
  const perShare =
    grant.grantType === GrantType.NSO
      ? Math.max(0, grant.currentFmv - grant.strikePrice) // NSO: spread above strike
      : grant.currentFmv; // RSU: full FMV (strike is 0)
  return unvestedShares * perShare;
}

/**
 * Returns true when the grant type triggers ISO AMT preference treatment.
 * ISO exercises create a bargain-element AMT preference item — not ordinary income.
 * RSU and NSO both return false (their income is ordinary).
 */
export const isIsoAmtPreference = (t: GrantType): boolean => t === GrantType.ISO;

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
