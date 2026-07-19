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

export function computeEquityValue(grant: GrantInput, todayIso: string): EquityValueResult {
  // Wave 11 T10: takes the LOCAL calendar day (YYYY-MM-DD) directly — the
  // callers hold useLocalToday()'s value — so vest-date comparisons are
  // timezone-proof and clock-free-testable (no internal toISOString derivation).
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

/** UTC-safe YYYY-MM-DD + n months, day CLAMPED to the target month's last day
 *  (review fix 1: setUTCMonth ROLLS Jan 31 + 1mo into Mar 3, silently
 *  stretching windows and skewing month arithmetic — "next 12 months" from a
 *  month-end day must land on the anniversary, not the month after). */
function addMonthsIso(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const firstOfTarget = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth(), Math.min(day, lastDay)),
  )
    .toISOString()
    .slice(0, 10);
}

export interface WindowVestEvent {
  date: string;
  shares: number;
  value: number;
  ordinaryIncome: number;
}

/** Vest events in (todayIso, todayIso + months]. Holder value per share
 *  (options net strike, floored at 0); ordinary income per the existing
 *  RSU/NSO/ISO rules (ISO → 0, AMT-preference not ordinary income). The walk
 *  updates prevPct on PAST entries too — that's what makes the first future
 *  entry's delta measure from the already-vested pct. */
export function vestsInWindow(
  grants: ReadonlyArray<GrantInput>,
  todayIso: string,
  months: number,
): { events: WindowVestEvent[]; totalValue: number; totalOrdinaryIncome: number } {
  const end = addMonthsIso(todayIso, months);
  const events: WindowVestEvent[] = [];
  for (const g of grants) {
    const holderPerShare = perShareHolderValue(g);
    const incomePerShare =
      g.grantType === GrantType.ISO
        ? 0
        : g.grantType === GrantType.NSO
          ? Math.max(0, g.currentFmv - g.strikePrice)
          : g.currentFmv;
    let prevPct = 0;
    for (const entry of g.vestingSchedule) {
      const deltaPct = entry.cumulativePct - prevPct;
      prevPct = entry.cumulativePct;
      if (entry.date <= todayIso || entry.date > end || deltaPct <= 0) continue;
      const shares = deltaPct * g.totalShares;
      events.push({
        date: entry.date,
        shares,
        value: shares * holderPerShare,
        ordinaryIncome: shares * incomePerShare,
      });
    }
  }
  events.sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    events,
    totalValue: events.reduce((s, e) => s + e.value, 0),
    totalOrdinaryIncome: events.reduce((s, e) => s + e.ordinaryIncome, 0),
  };
}

export interface ForwardVestPoint {
  /** 'YYYY-MM' bucket key. */
  month: string;
  /** "Mon ’YY" tick label (D10). */
  label: string;
  cumulativeValue: number;
}

const FORWARD_MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  timeZone: 'UTC',
});

/**
 * D10: cumulative value vesting over the NEXT `months` months, monthly-
 * bucketed — the forward "ramp" a planning chart should show (the all-time
 * cumulative was dominated by already-vested history). Starts at 0.
 */
export function forwardVestChartData(
  grants: ReadonlyArray<GrantInput>,
  todayIso: string,
  months: number,
): ForwardVestPoint[] {
  const { events } = vestsInWindow(grants, todayIso, months);
  const valueByMonth = new Map<string, number>();
  for (const e of events) {
    const m = e.date.slice(0, 7);
    valueByMonth.set(m, (valueByMonth.get(m) ?? 0) + e.value);
  }
  // Review fix 1: bucket keys come from CALENDAR-month arithmetic on the
  // first of the month (Date.UTC(y, m+i, 1) — day 1 never rolls), so an
  // end-of-month today can neither skip nor double buckets. Current-month
  // convention: window events between today and month-end fold into the
  // FIRST bucket, so the chart's final cumulative always equals
  // vestsInWindow(...).totalValue — the headline's window figure.
  const y0 = Number(todayIso.slice(0, 4));
  const m0 = Number(todayIso.slice(5, 7));
  const points: ForwardVestPoint[] = [];
  let cumulative = valueByMonth.get(todayIso.slice(0, 7)) ?? 0;
  for (let i = 1; i <= months; i++) {
    const d = new Date(Date.UTC(y0, m0 - 1 + i, 1));
    const month = d.toISOString().slice(0, 7);
    cumulative += valueByMonth.get(month) ?? 0;
    points.push({
      month,
      label: `${FORWARD_MONTH_FORMATTER.format(d)} ’${month.slice(2, 4)}`,
      cumulativeValue: cumulative,
    });
  }
  return points;
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
  todayIso: string,
): number {
  const { unvestedShares } = computeEquityValue(grant, todayIso);
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
