import { describe, it, expect } from 'vitest';
import { computeBonusTax, type Bracket } from '@/lib/tax';

// -----------------------------------------------------------------------------
// Wiring-sweep R3 — MA-MFJ standardDeduction regression
//
// Pre-fix: the 6 calculator call sites (PaycheckCard, the old Bonus and
// Commission cards (now SupplementalPayCard), OvertimeCard, Retirement401kWithdrawalCard,
// IncomePopover) passed a scalar federal.standardDeduction. The legacy
// `normalizeStandardDeduction(scalar)` then applied that same federal SD
// ($32,200 MFJ in 2026) to state tax — under-collecting MA state tax by
// roughly $1,460/yr on an MA-MFJ $200k household.
//
// Post-fix: callers pass { federal, state, city } so state tax is computed
// against the correct (typically lower) state SD. MA's state SD is 0,
// so on $200k MFJ post-fix the state tax should match "no state SD"
// (i.e., $200k × 0.05 = $10,000 baseline before pretax + raise tweaks).
// -----------------------------------------------------------------------------

const FED_MFJ_2026: Bracket[] = [
  { min: 0,       max: 24800,  rate: 0.10 },
  { min: 24800,   max: 100800, rate: 0.12 },
  { min: 100800,  max: 211400, rate: 0.22 },
  { min: 211400,  max: 403550, rate: 0.24 },
  { min: 403550,  max: 512450, rate: 0.32 },
  { min: 512450,  max: 768700, rate: 0.35 },
  { min: 768700,  max: null,   rate: 0.37 },
];

// 2026 MA flat-ish brackets (MA charges 5% up to $1.083M then 9%).
const MA_MFJ_2026: Bracket[] = [
  { min: 0, max: 1083150, rate: 0.05 },
  { min: 1083150, max: null, rate: 0.09 },
];

const FEDERAL_MFJ_SD = 32200;
const MA_STATE_SD = 0;

describe('R3 — calculator MA-MFJ standardDeduction regression', () => {
  it('per-jurisdiction SD yields the SAME state tax as state SD = 0 (the correct answer)', () => {
    // Reference: compute MA state tax using just state SD = 0 directly,
    // ignoring the federal SD entirely. That's the correct mathematical
    // outcome for MA (where the state's own SD is $0).
    const grossMfj = 200_000;
    const stateTaxableCorrect = Math.max(0, grossMfj - MA_STATE_SD);
    const stateTaxCorrect = 0.05 * stateTaxableCorrect;

    // Pre-fix shape (scalar federal SD applied to state):
    const preFix = computeBonusTax({
      personGross: grossMfj,
      bonus: 0,
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
      filingStatus: 'MFJ',
      federalBrackets: FED_MFJ_2026,
      stateBrackets: MA_MFJ_2026,
      cityBrackets: null,
      standardDeduction: FEDERAL_MFJ_SD,
    });

    // Post-fix shape (per-jurisdiction SD):
    const postFix = computeBonusTax({
      personGross: grossMfj,
      bonus: 0,
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
      filingStatus: 'MFJ',
      federalBrackets: FED_MFJ_2026,
      stateBrackets: MA_MFJ_2026,
      cityBrackets: null,
      standardDeduction: {
        federal: FEDERAL_MFJ_SD,
        state: MA_STATE_SD,
        city: 0,
      },
    });

    // Sanity — federal tax should be identical between the two shapes.
    expect(postFix.federalTax).toBeCloseTo(preFix.federalTax, 2);

    // Post-fix state tax should match the "MA SD = 0" correct answer.
    expect(postFix.stateTax).toBeCloseTo(stateTaxCorrect, 2);

    // Pre-fix state tax was reduced by 5% × $32,200 = $1,610 — the bug.
    const expectedPreFixUnderCollection = 0.05 * FEDERAL_MFJ_SD;
    expect(postFix.stateTax - preFix.stateTax).toBeCloseTo(
      expectedPreFixUnderCollection,
      2,
    );

    // The dollar magnitude — pre-fix under-collected ~$1,610/yr for this
    // household at MA's 5% flat rate.
    expect(postFix.stateTax - preFix.stateTax).toBeGreaterThan(1500);
    expect(postFix.stateTax - preFix.stateTax).toBeLessThan(1700);
  });
});
