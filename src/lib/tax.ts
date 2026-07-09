import { CONTRIBUTION_LIMITS_2026, hsaLimitForHousehold, dcfsaLimit } from './contribution-limits';

export interface Bracket {
  min: number;       // inclusive lower bound
  max: number | null; // exclusive upper bound; null = unbounded
  rate: number;      // 0..1
}

export function evaluateBrackets(brackets: Bracket[], taxableIncome: number): number {
  if (taxableIncome < 0) throw new Error('taxableIncome must be non-negative');
  if (taxableIncome === 0) return 0;

  let tax = 0;
  for (const b of brackets) {
    if (taxableIncome <= b.min) break;
    const top = b.max === null ? taxableIncome : Math.min(b.max, taxableIncome);
    tax += (top - b.min) * b.rate;
    if (b.max === null || taxableIncome <= b.max) break;
  }
  return tax;
}

const ADDITIONAL_MEDICARE_THRESHOLD = {
  SINGLE: 200000,
  HOH: 200000,
  MFS: 125000,
  MFJ: 250000,
} as const;

export interface FicaBreakdown {
  /** 6.2% Social Security, levied up to the annual wage base. */
  socialSecurity: number;
  /** 1.45% Medicare, uncapped. */
  medicare: number;
  /** 0.9% Additional Medicare on wages above the filing-status threshold; 0 otherwise. */
  additionalMedicare: number;
  /** socialSecurity + medicare + additionalMedicare. Equals the legacy computeFica scalar. */
  total: number;
}

/**
 * FICA split into its components. Added 2026-05-28 (v1.1) so the Paycheck
 * Calculator can show separate Social Security / Medicare rows and surface
 * the Additional Medicare surtax only when it triggers.
 *
 * `computeFica` below delegates to this and returns `.total`, so every
 * existing caller (computeTotalTax → TotalTaxOutput.fica, computeBonusTax,
 * PaycheckCard/BonusTaxCard/CommissionTaxCard) is unaffected.
 */
export function computeFicaBreakdown(
  gross: number,
  filingStatus: keyof typeof ADDITIONAL_MEDICARE_THRESHOLD,
): FicaBreakdown {
  if (gross < 0) throw new Error('gross must be non-negative');
  const ssBase = Math.min(gross, CONTRIBUTION_LIMITS_2026.SOCIAL_SECURITY_WAGE_BASE);
  const socialSecurity = ssBase * 0.062;
  const medicare = gross * 0.0145;
  const threshold = ADDITIONAL_MEDICARE_THRESHOLD[filingStatus];
  const additionalMedicare = gross > threshold ? (gross - threshold) * 0.009 : 0;
  return {
    socialSecurity,
    medicare,
    additionalMedicare,
    total: socialSecurity + medicare + additionalMedicare,
  };
}

export function computeFica(
  gross: number,
  filingStatus: keyof typeof ADDITIONAL_MEDICARE_THRESHOLD,
): number {
  return computeFicaBreakdown(gross, filingStatus).total;
}

/**
 * Household FICA across one OR two earners (Wave 2 §6, per IRS Form 8959 /
 * per-return rules):
 *   - Social Security: PER PERSON — each earner has their own annual wage
 *     base. Feeding a combined dual-earner gross through one base (the old
 *     engine path) under-collected ~$7.2k/yr for a dual-$150k household.
 *   - Medicare 1.45%: linear, computed on the combined total.
 *   - Additional Medicare 0.9%: on COMBINED wages above the per-RETURN
 *     filing-status threshold — a dual-$150k MFJ couple owes it on $50k even
 *     though neither earner crosses $250k alone.
 * A single-element array is byte-identical to computeFica(gross, fs).
 */
export function computeHouseholdFica(
  perPersonGrosses: number[],
  filingStatus: keyof typeof ADDITIONAL_MEDICARE_THRESHOLD,
): FicaBreakdown {
  let socialSecurity = 0;
  let combined = 0;
  for (const gross of perPersonGrosses) {
    if (gross < 0) throw new Error('gross must be non-negative');
    socialSecurity +=
      Math.min(gross, CONTRIBUTION_LIMITS_2026.SOCIAL_SECURITY_WAGE_BASE) * 0.062;
    combined += gross;
  }
  const medicare = combined * 0.0145;
  const threshold = ADDITIONAL_MEDICARE_THRESHOLD[filingStatus];
  const additionalMedicare = combined > threshold ? (combined - threshold) * 0.009 : 0;
  return {
    socialSecurity,
    medicare,
    additionalMedicare,
    total: socialSecurity + medicare + additionalMedicare,
  };
}

export interface PretaxDeductionsInput {
  salary: number;
  pretax401kPct: number;             // 0..1
  healthInsuranceMonthlyPremium: number;
  dcfsaMonthly: number;
  hsaMonthly: number;
  hsaEligible: boolean;
  filingStatus: 'SINGLE' | 'MFJ' | 'MFS' | 'HOH';
  personCount: number;
  dependentCount: number;
}

export interface PretaxDeductionsOutput {
  pretax401k: number;
  pretaxHealth: number;
  pretaxDcfsa: number;
  pretaxHsa: number;
  total: number;
}

export function computePretaxDeductions(input: PretaxDeductionsInput): PretaxDeductionsOutput {
  const pretax401k = Math.min(
    input.salary * input.pretax401kPct,
    CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K,
  );
  const pretaxHealth = input.healthInsuranceMonthlyPremium * 12;
  const pretaxDcfsa = Math.min(input.dcfsaMonthly * 12, dcfsaLimit(input.filingStatus));
  const hsaCap = hsaLimitForHousehold({ personCount: input.personCount, dependentCount: input.dependentCount });
  const pretaxHsa = input.hsaEligible ? Math.min(input.hsaMonthly * 12, hsaCap) : 0;
  return { pretax401k, pretaxHealth, pretaxDcfsa, pretaxHsa, total: pretax401k + pretaxHealth + pretaxDcfsa + pretaxHsa };
}

/**
 * Per-jurisdiction standard deductions. The engine threads three distinct
 * values; calculators that have always operated on federal-only (e.g.,
 * `BonusTaxCard`, `PaycheckCard`) still pass a single `number` and the
 * legacy semantics apply (same SD to all three jurisdictions).
 *
 * Bug-fix history: pre-2026-05-27 the engine seeded the federal SD into
 * the state computation, materially under-collecting state tax for MA
 * ($0 state SD) and CA (per-state SD ≠ federal). Per-jurisdiction
 * threading lands the correct math.
 */
export type StandardDeductionInput =
  | number
  | { federal: number; state: number; city: number };

function normalizeStandardDeduction(input: StandardDeductionInput): {
  federal: number;
  state: number;
  city: number;
} {
  if (typeof input === 'number') {
    return { federal: input, state: input, city: input };
  }
  return input;
}

export interface TotalTaxInput {
  gross: number;                       // person or household gross income for the period (ordinary wages)
  filingStatus: 'SINGLE' | 'MFJ' | 'MFS' | 'HOH';
  federalBrackets: Bracket[];
  stateBrackets: Bracket[];            // [] for no-state-tax jurisdictions (TX, FL, etc.)
  cityBrackets: Bracket[] | null;      // null for no city tax
  /**
   * Standard deduction. Either:
   *   - a single `number` (legacy single-jurisdiction calculator behavior:
   *     applied to federal, state, AND city taxable amounts), or
   *   - `{ federal, state, city }` for engine-driven projections that need
   *     to compute each jurisdiction's taxable income against its own SD.
   */
  standardDeduction: StandardDeductionInput;
  pretax: {
    pretax401k: number;
    pretaxHealth: number;
    pretaxDcfsa: number;
    pretaxHsa: number;
  };
  /**
   * Per-person wage split of `gross` (Wave 2 §6). When present, FICA is
   * computed per earner (own SS wage base each) with Medicare surtaxes on
   * the combined return via computeHouseholdFica. When omitted, FICA runs
   * on the combined `gross` — the legacy single-base behavior every
   * single-person caller (computeBonusTax, PaycheckCalculator) relies on.
   * Callers must ensure the entries sum to `gross`.
   */
  perPersonGross?: number[];
  // ---------------------------------------------------------------------------
  // Investment income (Task 3 — Finance review #5).
  // All optional. When omitted the legacy ordinary-only math runs unchanged.
  // ---------------------------------------------------------------------------
  /** Long-term capital gains. Taxed via the LTCG schedule stacking on ordinary income. */
  longTermGains?: number;
  /** Qualified dividends — taxed at the same LTCG schedule as long-term gains. */
  qualifiedDividends?: number;
  /** Non-qualified (ordinary) dividends — taxed at ordinary brackets, added to wages stack. */
  nonQualifiedDividends?: number;
  /**
   * LTCG brackets (0% / 15% / 20%) for the filing status. Required iff any
   * of {longTermGains, qualifiedDividends} > 0; otherwise ignored.
   */
  ltcgBrackets?: Bracket[];
}

export interface TotalTaxOutput {
  federal: number;
  fica: number;
  state: number;
  city: number;
  /**
   * 3.8% Net Investment Income Tax (IRC §1411) on the lesser of net investment
   * income or MAGI excess above the filing-status threshold. Always present in
   * the output; 0 when no LTCG/qualified income provided OR MAGI below
   * threshold. See computeNiit for the standalone helper.
   */
  niit: number;
  total: number;
  /** total / gross — 0 when gross is 0 */
  effectiveRate: number;
}

// -----------------------------------------------------------------------------
// Long-term capital gains (LTCG) + qualified dividends.
//
// Pre-2026-05-27 the engine treated cap gains as ordinary income, applying
// the 10–37% federal schedule. The IRS taxes LTCG and qualified dividends
// against a separate 0% / 15% / 20% schedule that *stacks on top of*
// ordinary income — meaning the brackets are evaluated as if the ordinary
// income filled the lowest tiers first.
// -----------------------------------------------------------------------------
export interface LtcgInput {
  /** Ordinary income that sits "below" qualified income in the stack. */
  ordinaryIncome: number;
  /** Long-term capital gains (held > 1 year). */
  longTermGains: number;
  /** Qualified dividends — taxed at the same LTCG schedule. */
  qualifiedDividends: number;
  /** LTCG brackets (0% / 15% / 20%) for the filing status. */
  ltcgBrackets: Bracket[];
  /** Filing status — kept for symmetry with other tax helpers; not currently used inside computeLtcgTax (brackets carry status). */
  filingStatus: 'SINGLE' | 'MFJ' | 'MFS' | 'HOH';
  /**
   * Wave-9 M65: standard deduction left UNUSED by ordinary income
   * (max(0, deduction − ordinary income before flooring)). The QDCGT
   * worksheet nets taxable income before splitting the stacks, so this
   * remainder shelters the bottom of the gains stack. Default 0.
   */
  unusedOrdinaryDeduction?: number;
}

export interface LtcgOutput {
  federalLtcgTax: number;
}

/**
 * Apply the LTCG schedule to long-term gains + qualified dividends, with the
 * income "stacking" semantics: gains are taxed starting at the bracket where
 * ordinary income leaves off. Equivalent to:
 *   tax_on(ordinary + gains) - tax_on(ordinary)
 * using the LTCG bracket schedule.
 */
export function computeLtcgTax(input: LtcgInput): LtcgOutput {
  const unused = Math.max(0, input.unusedOrdinaryDeduction ?? 0);
  const qualifiedIncome = Math.max(0, input.longTermGains + input.qualifiedDividends - unused);
  if (qualifiedIncome <= 0) return { federalLtcgTax: 0 };
  if (input.ordinaryIncome < 0) throw new Error('ordinaryIncome must be non-negative');

  const stackBottom = input.ordinaryIncome;
  const stackTop = input.ordinaryIncome + qualifiedIncome;

  // Apply the bracket schedule between stackBottom and stackTop.
  const taxAtTop = evaluateBrackets(input.ltcgBrackets, stackTop);
  const taxAtBottom = evaluateBrackets(input.ltcgBrackets, stackBottom);
  return { federalLtcgTax: Math.max(0, taxAtTop - taxAtBottom) };
}

// -----------------------------------------------------------------------------
// Net Investment Income Tax (NIIT) — IRC §1411.
//
// 3.8% surtax on the LESSER of net investment income (interest + dividends +
// cap gains + passive rental/royalty/partnership income) or MAGI excess above
// the filing-status threshold. Thresholds have been static since 2013 (not
// inflation-indexed):
//   SINGLE / HOH:  $200,000
//   MFJ:           $250,000
//   MFS:           $125,000
// -----------------------------------------------------------------------------
export interface NiitInput {
  magi: number;
  netInvestmentIncome: number;
  filingStatus: 'SINGLE' | 'MFJ' | 'MFS' | 'HOH';
}

export interface NiitOutput {
  niit: number;
}

const NIIT_THRESHOLD = {
  SINGLE: 200_000,
  HOH:    200_000,
  MFJ:    250_000,
  MFS:    125_000,
} as const;

export function computeNiit(input: NiitInput): NiitOutput {
  if (input.netInvestmentIncome < 0) return { niit: 0 };
  const threshold = NIIT_THRESHOLD[input.filingStatus];
  const magiExcess = Math.max(0, input.magi - threshold);
  const base = Math.min(input.netInvestmentIncome, magiExcess);
  return { niit: base * 0.038 };
}

/**
 * Federal + FICA + state + city tax on a single gross income. Pure: every bracket
 * and config value is an input. Shared by the simulator engine and `computeBonusTax`
 * (which runs this twice for marginal-rate diffing).
 */
export function computeTotalTax(input: TotalTaxInput): TotalTaxOutput {
  const pretaxTotal =
    input.pretax.pretax401k +
    input.pretax.pretaxHealth +
    input.pretax.pretaxDcfsa +
    input.pretax.pretaxHsa;

  const longTermGains = input.longTermGains ?? 0;
  const qualifiedDividends = input.qualifiedDividends ?? 0;
  const nonQualifiedDividends = input.nonQualifiedDividends ?? 0;
  const qualifiedIncome = longTermGains + qualifiedDividends;

  // Ordinary income includes W-2/gross + non-qualified dividends. Qualified
  // income runs through its own bracket schedule on top of the ordinary stack.
  const ordinaryIncome = input.gross + nonQualifiedDividends;

  const sd = normalizeStandardDeduction(input.standardDeduction);
  const federalTaxable = Math.max(0, ordinaryIncome - pretaxTotal - sd.federal);
  // State and city tax ordinary AND qualified income at the same bracket
  // schedule — most states don't have a separate LTCG schedule. This matches
  // the pre-fix behavior at the state level and avoids over-engineering for
  // the small handful of states that do (WA cap gains, MA Part B, etc.).
  const stateTaxableTotal = Math.max(0, ordinaryIncome + qualifiedIncome - pretaxTotal - sd.state);
  const cityTaxableTotal  = Math.max(0, ordinaryIncome + qualifiedIncome - pretaxTotal - sd.city);

  const federalOrdinary = ordinaryIncome > 0 ? evaluateBrackets(input.federalBrackets, federalTaxable) : 0;
  // LTCG federal tax — stacks on the ordinary federal taxable amount. This is
  // the closest single-pass equivalent to the IRS Qualified Dividends and
  // Capital Gain Tax Worksheet for a v1 model.
  let federalLtcg = 0;
  if (qualifiedIncome > 0 && input.ltcgBrackets && input.ltcgBrackets.length > 0) {
    federalLtcg = computeLtcgTax({
      ordinaryIncome: federalTaxable,
      longTermGains,
      qualifiedDividends,
      ltcgBrackets: input.ltcgBrackets,
      filingStatus: input.filingStatus,
      // Wave-9 M65: standard deduction the ordinary stack couldn't use
      // shelters the bottom of the gains stack (QDCGT worksheet nets taxable
      // income BEFORE splitting the stacks).
      unusedOrdinaryDeduction: Math.max(0, sd.federal - Math.max(0, ordinaryIncome - pretaxTotal)),
    }).federalLtcgTax;
  }
  const federal = federalOrdinary + federalLtcg;

  // FICA is levied on wages only — NOT on dividends, cap gains, or interest.
  // Per IRS Pub 15-A, qualified divs are not earned income; non-qualified
  // divs aren't either. So FICA stays on input.gross.
  //
  // FICA base correctness (Wave-3 Task 3): we deliberately do NOT subtract
  // any pretax items from the FICA base. Per IRS Pub 15 + 26 CFR §31.3121:
  //   - §401(k) elective deferrals ARE subject to FICA (federal income
  //     tax withholding reduces; FICA does not).
  //   - §125 cafeteria-plan items (pre-tax health insurance, FSA, payroll-
  //     deduction HSA) ARE excluded from FICA — but the engine does not
  //     currently track this distinction. The slight over-collection of
  //     FICA for cafeteria-plan users is flagged in the app_wide v1.3
  //     "What we don't model" disclosure.
  const fica = computeHouseholdFica(
    input.perPersonGross ?? [input.gross],
    input.filingStatus,
  ).total;
  const state = input.stateBrackets.length > 0 ? evaluateBrackets(input.stateBrackets, stateTaxableTotal) : 0;
  const city = input.cityBrackets ? evaluateBrackets(input.cityBrackets, cityTaxableTotal) : 0;

  // NIIT — 3.8% on the lesser of net investment income or MAGI excess.
  // Net II = qualified divs + non-qualified divs + LTCG (interest income
  // not modeled separately yet — would also flow here when threaded).
  // MAGI ≈ ordinary + qualified income for v1; the engine doesn't model the
  // foreign-earned-income exclusion add-back. NOTE (round-3): the OTHER
  // NIIT guard (computeIncrementalNiit below) proxies MAGI differently —
  // W-2 + cap gains + existing investment income — because its input
  // surface is the withdrawal calculator, not the dividend engine. Both
  // proxies ≈ AGI for v1; neither adds back FEIE.
  const netInvestmentIncome = qualifiedIncome + nonQualifiedDividends;
  const magi = ordinaryIncome + qualifiedIncome;
  const niit = netInvestmentIncome > 0
    ? computeNiit({
        magi,
        netInvestmentIncome,
        filingStatus: input.filingStatus,
      }).niit
    : 0;

  const total = federal + fica + state + city + niit;
  // For effectiveRate we keep the historical denominator (gross/W-2) unchanged
  // — adding investment income to the denominator would silently shift
  // effective-rate sentinels across hundreds of existing tests.
  const denominator = input.gross > 0 ? input.gross : 0;

  return {
    federal,
    fica,
    state,
    city,
    niit,
    total,
    effectiveRate: denominator > 0 ? total / denominator : 0,
  };
}

export interface BonusTaxInput {
  personGross: number;             // salary + bonus
  bonus: number;
  pretax: { pretax401k: number; pretaxHealth: number; pretaxDcfsa: number; pretaxHsa: number };
  filingStatus: 'SINGLE' | 'MFJ' | 'MFS' | 'HOH';
  federalBrackets: Bracket[];
  stateBrackets: Bracket[];
  cityBrackets: Bracket[] | null;
  standardDeduction: StandardDeductionInput;
  /**
   * Wave-9 F1: per-earner annual base grosses EXCLUDING `bonus`. When
   * present, FICA runs per earner (own SS wage base each, Medicare surtax on
   * the combined return) in BOTH the with- and without-bonus passes, with
   * `bonus` attributed to the earner at `recipientIndex` (default 0).
   * Entries must sum to `personGross - bonus`. When omitted, the legacy
   * combined-base behavior is preserved.
   */
  perPersonBaseGross?: number[];
  recipientIndex?: number;
}

export interface BonusTaxOutput {
  federalTax: number;
  fica: number;
  stateTax: number;
  cityTax: number;
  totalTax: number;
  effectiveRate: number;
  marginalRateOnBonus: number;
  bonusTakeHome: number;
  bonusBreakdown: {
    federal: number;
    fica: number;
    state: number;
    city: number;
    total: number;
  };
}

/**
 * Computes federal + FICA + state + city tax on a person's full gross (salary + bonus)
 * and derives the marginal rate paid on the bonus portion via a with/without-bonus diff.
 *
 * ASSUMPTION: `pretax` and `standardDeduction` are static across the with/without-bonus
 * paths. Callers should compute pretax deductions ONCE against base salary using
 * `computePretaxDeductions`, then pass the fixed result here. The bonus does not re-trigger
 * pretax caps in this calc.
 */
export function computeBonusTax(input: BonusTaxInput): BonusTaxOutput {
  const grossWithoutBonus = input.personGross - input.bonus;

  // Wave-9 F1: per-earner FICA split; the bonus rides on the recipient.
  const baseSplit = input.perPersonBaseGross;
  const recipient = input.recipientIndex ?? 0;
  const withSplit = baseSplit?.map((g, i) => (i === recipient ? g + input.bonus : g));

  const withBonus = computeTotalTax({
    gross: input.personGross,
    perPersonGross: withSplit,
    filingStatus: input.filingStatus,
    federalBrackets: input.federalBrackets,
    stateBrackets: input.stateBrackets,
    cityBrackets: input.cityBrackets,
    standardDeduction: input.standardDeduction,
    pretax: input.pretax,
  });

  const withoutBonus = computeTotalTax({
    gross: grossWithoutBonus,
    perPersonGross: baseSplit,
    filingStatus: input.filingStatus,
    federalBrackets: input.federalBrackets,
    stateBrackets: input.stateBrackets,
    cityBrackets: input.cityBrackets,
    standardDeduction: input.standardDeduction,
    pretax: input.pretax,
  });

  const bonusBreakdown = {
    federal: withBonus.federal - withoutBonus.federal,
    fica: withBonus.fica - withoutBonus.fica,
    state: withBonus.state - withoutBonus.state,
    city: withBonus.city - withoutBonus.city,
    total: withBonus.total - withoutBonus.total,
  };

  const marginalRateOnBonus = input.bonus > 0 ? bonusBreakdown.total / input.bonus : 0;
  const bonusTakeHome = input.bonus - bonusBreakdown.total;

  return {
    federalTax: withBonus.federal,
    fica: withBonus.fica,
    stateTax: withBonus.state,
    cityTax: withBonus.city,
    totalTax: withBonus.total,
    effectiveRate: withBonus.effectiveRate,
    marginalRateOnBonus,
    bonusTakeHome,
    bonusBreakdown,
  };
}

export interface WithdrawalTaxBreakdown {
  incrementalFederal: number;
  incrementalState: number;
  incrementalCity: number;
  earlyWithdrawalPenalty: number;
  /**
   * Incremental NIIT (3.8% Net Investment Income Tax under IRC §1411)
   * triggered by the withdrawal pushing MAGI above the filing-status
   * threshold ($200k SINGLE/HOH, $250k MFJ, $125k MFS). Zero when the
   * caller provides no investment income OR the household's MAGI stays
   * below threshold both with and without the withdrawal.
   *
   * The 401k distribution itself is NOT investment income (it's ordinary
   * income from a qualified plan, IRC §1411(c)(5)), but the resulting
   * MAGI bump can newly trigger or increase NIIT on the OTHER investment
   * income the household reports (interest, dividends, cap gains, rental).
   */
  incrementalNiit: number;
  totalTaxOnWithdrawal: number;
  netToUser: number;
  effectiveRate: number;
}

export interface WithdrawalTaxInput {
  withdrawalAmount: number;
  annualW2Income: number;
  annualCapitalGains: number;
  ageAtWithdrawal: number;
  filingStatus: 'SINGLE' | 'MFJ' | 'MFS' | 'HOH';
  federalBrackets: Bracket[];
  stateBrackets: Bracket[];
  cityBrackets: Bracket[] | null;
  /**
   * Per-jurisdiction standard deduction. Accepts the legacy scalar
   * (applied to federal AND state) or the per-jurisdiction object for
   * callers that have state SD data.
   */
  federalStandardDeduction: StandardDeductionInput;
  taxYear: number;
  /**
   * LTCG (0% / 15% / 20%) federal schedule. When provided, `annualCapitalGains`
   * are treated as long-term gains taxed at the LTCG schedule stacking on
   * ordinary income. When omitted, gains flow through ordinary brackets
   * (legacy v1 behavior — kept so existing callers that haven't sourced
   * the LTCG schedule yet don't silently change results).
   */
  ltcgBrackets?: Bracket[];
  /**
   * Other investment income (interest, non-qualified dividends, royalties,
   * passive rental) for the year — used by the NIIT delta computation.
   * `annualCapitalGains` is added to this internally to form the
   * net-investment-income base under IRC §1411(c). Defaults to 0; when
   * the resulting NII + MAGI falls below the filing-status threshold,
   * the incremental NIIT is 0 and the caller's existing breakdown lines
   * are unchanged.
   */
  existingInvestmentIncome?: number;
}

/**
 * Incremental tax a Traditional 401k withdrawal triggers on top of existing
 * ordinary income, via the with/without-X diff pattern (mirrors computeBonusTax).
 * FICA is not levied on 401k distributions; the 10% penalty fires strictly when
 * ageAtWithdrawal < 59.5. Roth distributions and IRS exceptions (separation at
 * 55+, hardship, SEPP/72(t)) are not modeled.
 */
export function calculate401kWithdrawalTax(input: WithdrawalTaxInput): WithdrawalTaxBreakdown {
  if (input.withdrawalAmount < 0) throw new Error('withdrawalAmount must be non-negative');
  if (input.annualW2Income < 0) throw new Error('annualW2Income must be non-negative');
  if (input.annualCapitalGains < 0) throw new Error('annualCapitalGains must be non-negative');
  if (input.ageAtWithdrawal < 0 || input.ageAtWithdrawal > 130) throw new Error('ageAtWithdrawal out of range');

  // Standard deduction widens to per-jurisdiction (R3 wiring-sweep). Legacy
  // scalar callers continue to work — same SD applied to fed + state.
  const sd = normalizeStandardDeduction(input.federalStandardDeduction);
  const useLtcg = input.ltcgBrackets !== undefined && input.ltcgBrackets.length > 0;

  // Ordinary-income stack: W-2 only when LTCG schedule is provided, else
  // legacy "ordinary + gains" lump for back-compat.
  const ordinaryBase = useLtcg
    ? input.annualW2Income
    : input.annualW2Income + input.annualCapitalGains;

  const adjustedOrdinaryWithout = Math.max(0, ordinaryBase - sd.federal);
  const adjustedOrdinaryWith = Math.max(0, ordinaryBase + input.withdrawalAmount - sd.federal);

  // Federal ordinary tax (before + after the withdrawal lands as ordinary income).
  const federalOrdinaryWithout = evaluateBrackets(input.federalBrackets, adjustedOrdinaryWithout);
  const federalOrdinaryWith = evaluateBrackets(input.federalBrackets, adjustedOrdinaryWith);

  // Federal LTCG tax — stacks on the ordinary post-SD amount. Both with
  // and without the withdrawal use the same `annualCapitalGains`; the
  // withdrawal increases the ordinary stack-bottom, potentially pushing
  // cap gains into a higher LTCG bracket. That delta is the
  // "withdrawal triggered higher LTCG bracket" effect.
  let federalLtcgWithout = 0;
  let federalLtcgWith = 0;
  if (useLtcg && input.annualCapitalGains > 0) {
    // Wave-9 M65: the leftover federal SD (unused by the ordinary stack)
    // shelters the bottom of the gains stack in both passes.
    federalLtcgWithout = computeLtcgTax({
      ordinaryIncome: adjustedOrdinaryWithout,
      longTermGains: input.annualCapitalGains,
      qualifiedDividends: 0,
      ltcgBrackets: input.ltcgBrackets!,
      filingStatus: input.filingStatus,
      unusedOrdinaryDeduction: Math.max(0, sd.federal - ordinaryBase),
    }).federalLtcgTax;
    federalLtcgWith = computeLtcgTax({
      ordinaryIncome: adjustedOrdinaryWith,
      longTermGains: input.annualCapitalGains,
      qualifiedDividends: 0,
      ltcgBrackets: input.ltcgBrackets!,
      filingStatus: input.filingStatus,
      unusedOrdinaryDeduction: Math.max(0, sd.federal - (ordinaryBase + input.withdrawalAmount)),
    }).federalLtcgTax;
  }

  const incrementalFederal =
    (federalOrdinaryWith + federalLtcgWith) -
    (federalOrdinaryWithout + federalLtcgWithout);

  // State + city: most states tax LTCG as ordinary income, so the simplest
  // model is "all income — wages, cap gains, and withdrawal — runs through
  // state brackets after the state SD." That matches the engine's behavior
  // in src/lib/tax.ts:262.
  const stateBase = input.annualW2Income + input.annualCapitalGains;
  const adjustedStateWithout = Math.max(0, stateBase - sd.state);
  const adjustedStateWith = Math.max(0, stateBase + input.withdrawalAmount - sd.state);
  const stateWithout = input.stateBrackets.length > 0 ? evaluateBrackets(input.stateBrackets, adjustedStateWithout) : 0;
  const stateWith = input.stateBrackets.length > 0 ? evaluateBrackets(input.stateBrackets, adjustedStateWith) : 0;
  const incrementalState = stateWith - stateWithout;

  const adjustedCityWithout = Math.max(0, stateBase - sd.city);
  const adjustedCityWith = Math.max(0, stateBase + input.withdrawalAmount - sd.city);
  const cityWithout = input.cityBrackets ? evaluateBrackets(input.cityBrackets, adjustedCityWithout) : 0;
  const cityWith = input.cityBrackets ? evaluateBrackets(input.cityBrackets, adjustedCityWith) : 0;
  const incrementalCity = cityWith - cityWithout;

  const earlyWithdrawalPenalty = input.ageAtWithdrawal < 59.5 ? input.withdrawalAmount * 0.10 : 0;

  // NIIT delta — the 401k withdrawal isn't itself investment income (IRC
  // §1411(c)(5) excludes qualified-plan distributions), but the resulting
  // MAGI bump can newly trigger or increase NIIT on the household's OTHER
  // investment income. We compute NIIT with and without the withdrawal and
  // take the diff. When the caller passes no investment income OR MAGI
  // stays below threshold both ways, the delta is 0.
  const existingInvestmentIncome = input.existingInvestmentIncome ?? 0;
  const netInvestmentIncome = existingInvestmentIncome + input.annualCapitalGains;
  let incrementalNiit = 0;
  if (netInvestmentIncome > 0) {
    // MAGI for NIIT purposes ≈ AGI for v1 (no foreign-earned-income
    // exclusion add-back modeled). Use pre-SD ordinary income +
    // capital gains + other investment income as the proxy. NOTE
    // (round-3): the dividend-engine NIIT guard above proxies MAGI as
    // ordinary + qualified income instead — a different input surface
    // (it has no W-2/withdrawal split); both proxies ≈ AGI for v1.
    const magiBase =
      input.annualW2Income + input.annualCapitalGains + existingInvestmentIncome;
    const niitWithout = computeNiit({
      magi: magiBase,
      netInvestmentIncome,
      filingStatus: input.filingStatus,
    }).niit;
    const niitWith = computeNiit({
      magi: magiBase + input.withdrawalAmount,
      netInvestmentIncome,
      filingStatus: input.filingStatus,
    }).niit;
    incrementalNiit = niitWith - niitWithout;
  }

  const totalTaxOnWithdrawal =
    incrementalFederal +
    incrementalState +
    incrementalCity +
    earlyWithdrawalPenalty +
    incrementalNiit;
  const netToUser = input.withdrawalAmount - totalTaxOnWithdrawal;
  const effectiveRate = input.withdrawalAmount > 0 ? totalTaxOnWithdrawal / input.withdrawalAmount : 0;

  return {
    incrementalFederal,
    incrementalState,
    incrementalCity,
    earlyWithdrawalPenalty,
    incrementalNiit,
    totalTaxOnWithdrawal,
    netToUser,
    effectiveRate,
  };
}
