import { computeTotalTax, computeHouseholdFica, type Bracket } from '@/lib/tax';
import { computeTakeHome } from '@/lib/paycheck-takehome';
import type { HouseholdPretax } from '@/lib/calculators/supplemental-wage';
import type { FilingStatus } from '@/types/enums';

export interface PaycheckInput {
  /** Annual ordinary gross (salary only — no supplemental wages). */
  gross: number;
  /** Per-earner split of `gross` (entries MUST sum to it) — drives per-earner SS wage bases (Wave-9 F1). */
  perPersonGross: number[];
  filingStatus: FilingStatus;
  federalBrackets: Bracket[];
  stateBrackets: Bracket[];
  cityBrackets: Bracket[] | null;
  standardDeduction: { federal: number; state: number; city: number };
  /** Pre-derived annual pre-tax deductions. Callers own the derivation:
   *  the card aggregates the profile (aggregateHouseholdPretax, per-return
   *  caps), the page derives from its editable form (blended % re-capped per
   *  earner + FSA fold). See Wave-15 D1. */
  pretax: HouseholdPretax;
  /** Roth 401(k) + other post-tax deductions, annual. Default 0 (the card). */
  postTaxAnnual?: number;
  /** W-4 4(c) extra federal withholding, annual. Default 0 (the card). */
  extraWithholdingAnnual?: number;
}

export interface PaycheckResult {
  gross: number;
  pretax401k: number;
  pretaxHealth: number;
  pretaxDcfsa: number;
  pretaxHsa: number;
  pretaxTotal: number;
  /** Annual federal bracket LIABILITY — not payroll withholding (W-4 +
   *  percentage-method tables determine that). Consumers must label it so. */
  federal: number;
  ss: number;
  medicare: number;
  additionalMedicare: number;
  /** Combined FICA (= ss + medicare + additionalMedicare). */
  fica: number;
  stateTax: number;
  cityTax: number;
  /** No-state-tax detection: seed migrations store no-income-tax states as a
   *  single ZERO-RATE bracket (never []) — detect via rate > 0, NOT .length. */
  hasStateTax: boolean;
  hasCity: boolean;
  postTaxTotal: number;
  extraWithholdingTotal: number;
  takeHome: number;
}

/**
 * The ONE paycheck composition engine (Wave 15 Task 1). PaycheckCard and
 * PaycheckCalculator both consume this — the card is a summary of the SAME
 * numbers the full page computes, never a parallel engine.
 */
export function computePaycheck(input: PaycheckInput): PaycheckResult {
  const pretaxTotal =
    input.pretax.pretax401k +
    input.pretax.pretaxHealth +
    input.pretax.pretaxDcfsa +
    input.pretax.pretaxHsa;

  const tax = computeTotalTax({
    gross: input.gross,
    perPersonGross: input.perPersonGross,
    filingStatus: input.filingStatus,
    federalBrackets: input.federalBrackets,
    stateBrackets: input.stateBrackets,
    cityBrackets: input.cityBrackets,
    standardDeduction: input.standardDeduction,
    pretax: input.pretax,
  });
  const fica = computeHouseholdFica(input.perPersonGross, input.filingStatus);

  const postTaxTotal = input.postTaxAnnual ?? 0;
  const extraWithholdingTotal = input.extraWithholdingAnnual ?? 0;
  const takeHome = computeTakeHome({
    gross: input.gross,
    pretaxTotal,
    taxTotal: tax.total,
    postTaxTotal,
    extraWithholdingTotal,
  });

  return {
    gross: input.gross,
    pretax401k: input.pretax.pretax401k,
    pretaxHealth: input.pretax.pretaxHealth,
    pretaxDcfsa: input.pretax.pretaxDcfsa,
    pretaxHsa: input.pretax.pretaxHsa,
    pretaxTotal,
    federal: tax.federal,
    ss: fica.socialSecurity,
    medicare: fica.medicare,
    additionalMedicare: fica.additionalMedicare,
    fica: tax.fica,
    stateTax: tax.state,
    cityTax: tax.city,
    hasStateTax: input.stateBrackets.some((b) => b.rate > 0),
    hasCity: !!input.cityBrackets,
    postTaxTotal,
    extraWithholdingTotal,
    takeHome,
  };
}
