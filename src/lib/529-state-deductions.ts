/**
 * 529 plan state income tax deduction lookup table.
 *
 * Reference data only. Static snapshot of states that allow a state income tax
 * deduction (or, in some cases, a deduction-equivalent) for contributions to a
 * 529 college-savings plan, with maximum deductible amounts by filing status.
 *
 * Sourced from publicly published state-by-state summaries (e.g.
 * Saving for College). Figures reflect the most recently confirmed limits;
 * some states publish only annually and may not have a confirmed 2026 figure
 * at the time of writing — those entries fall back to the prior year and are
 * called out in the per-state `notes` field below where relevant.
 *
 * IMPORTANT: This data is for in-app planning hints and tooltips only. Users
 * should confirm current limits with their state Department of Revenue (DOR)
 * before relying on these numbers for actual tax filing.
 *
 * Notable mechanics encoded here:
 * - "Per taxpayer" states (NY, IL, MI, OK, MS, …) double the SINGLE limit for
 *   MFJ because each spouse claims their own deduction.
 * - "Per account" / "per beneficiary" states (VA, OH, GA, WI, MD, …) cap by
 *   account, so SINGLE and MFJ share the same dollar limit.
 * - PA mirrors the federal annual gift exclusion and doubles for MFJ.
 * - NM allows a deduction with no statutory dollar cap; encoded as a sentinel
 *   (`UNLIMITED_DEDUCTION_SENTINEL`) so consumers can detect and render it
 *   appropriately rather than treating 999_999 as a literal cap.
 */

export type FilingStatus = 'SINGLE' | 'MFJ' | 'MFS' | 'HOH';

export interface Deduction529 {
  /** Two-letter USPS state code. */
  state: string;
  /** Maximum deductible 529 contribution for the requested filing status. */
  maxAmount: number;
  /** Optional human-readable caveat or vintage note. */
  notes?: string;
}

/**
 * Sentinel value used for states (e.g. NM) that allow an effectively
 * unlimited 529 deduction. Consumers should branch on this constant rather
 * than treat it as a real dollar amount.
 */
export const UNLIMITED_DEDUCTION_SENTINEL = 999_999;

interface DeductionRow {
  amounts: Partial<Record<FilingStatus, number>>;
  notes?: string;
}

const TABLE_2026: Record<string, DeductionRow> = {
  // Per-taxpayer states — MFJ doubles SINGLE because each spouse deducts.
  NY: {
    amounts: { SINGLE: 5000, MFJ: 10000, MFS: 5000, HOH: 5000 },
    notes: 'Per taxpayer; MFJ doubles. Confirm with NY DTF for tax filing.',
  },
  IL: {
    amounts: { SINGLE: 10000, MFJ: 20000, MFS: 10000, HOH: 10000 },
    notes: 'Per taxpayer; MFJ doubles. Bright Start / Bright Directions plans.',
  },
  PA: {
    amounts: { SINGLE: 18000, MFJ: 36000, MFS: 18000, HOH: 18000 },
    notes: 'Tracks federal annual gift exclusion; MFJ doubles.',
  },
  MI: {
    amounts: { SINGLE: 5000, MFJ: 10000, MFS: 5000, HOH: 5000 },
    notes: 'Per taxpayer; MFJ doubles.',
  },
  OK: {
    amounts: { SINGLE: 10000, MFJ: 20000, MFS: 10000, HOH: 10000 },
    notes: 'Per taxpayer; MFJ doubles.',
  },
  MS: {
    amounts: { SINGLE: 10000, MFJ: 20000, MFS: 10000, HOH: 10000 },
    notes: 'Per taxpayer; MFJ doubles.',
  },

  // Per-account / per-beneficiary states — SINGLE and MFJ caps match.
  VA: {
    amounts: { SINGLE: 4000, MFJ: 4000, MFS: 4000, HOH: 4000 },
    notes: 'Per account, per year. Carryforward allowed.',
  },
  MA: {
    amounts: { SINGLE: 1000, MFJ: 2000, MFS: 1000, HOH: 1000 },
    notes: 'Modest cap. Per taxpayer; MFJ doubles.',
  },
  OH: {
    amounts: { SINGLE: 4000, MFJ: 4000, MFS: 4000, HOH: 4000 },
    notes: 'Per beneficiary, per year. Carryforward allowed.',
  },
  GA: {
    amounts: { SINGLE: 4000, MFJ: 8000, MFS: 4000, HOH: 4000 },
    notes: 'Per beneficiary; MFJ doubles.',
  },
  WI: {
    amounts: { SINGLE: 4040, MFJ: 4040, MFS: 2020, HOH: 4040 },
    notes: 'Per beneficiary; MFS halved. Most recently confirmed figure — verify annually.',
  },
  MD: {
    amounts: { SINGLE: 2500, MFJ: 2500, MFS: 2500, HOH: 2500 },
    notes: 'Per beneficiary, per account holder. Carryforward allowed.',
  },

  // Special mechanics.
  MN: {
    amounts: { SINGLE: 1500, MFJ: 3000, MFS: 1500, HOH: 1500 },
    notes: 'Deduction OR a 50% credit on the first $500/$1,000 — taxpayer chooses.',
  },
  CO: {
    amounts: { SINGLE: 28100, MFJ: 28100, MFS: 14050, HOH: 28100 },
    notes: 'Effectively the state taxable-income cap; verify current-year figure.',
  },
  NM: {
    amounts: {
      SINGLE: UNLIMITED_DEDUCTION_SENTINEL,
      MFJ: UNLIMITED_DEDUCTION_SENTINEL,
      MFS: UNLIMITED_DEDUCTION_SENTINEL,
      HOH: UNLIMITED_DEDUCTION_SENTINEL,
    },
    notes: 'Effectively unlimited deduction — confirm state cap with DOR.',
  },
};

/**
 * Look up the 2026 (most-recent-confirmed) 529 state-tax deduction for a
 * given USPS state code and filing status.
 *
 * Returns `null` when the state does not appear in the lookup (no deduction
 * exists, or it is not yet encoded), or when the state appears but does not
 * have an amount published for the requested filing status.
 */
export function get529DeductionForState(
  state: string,
  filingStatus: FilingStatus,
): Deduction529 | null {
  const row = TABLE_2026[state];
  if (!row) return null;
  const amt = row.amounts[filingStatus];
  if (amt === undefined) return null;
  return {
    state,
    maxAmount: amt,
    ...(row.notes ? { notes: row.notes } : {}),
  };
}
