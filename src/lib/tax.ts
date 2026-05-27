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

export function computeFica(gross: number, filingStatus: keyof typeof ADDITIONAL_MEDICARE_THRESHOLD): number {
  if (gross < 0) throw new Error('gross must be non-negative');
  const ssBase = Math.min(gross, CONTRIBUTION_LIMITS_2026.SOCIAL_SECURITY_WAGE_BASE);
  const ss = ssBase * 0.062;
  const medicareBase = gross * 0.0145;
  const threshold = ADDITIONAL_MEDICARE_THRESHOLD[filingStatus];
  const additionalMedicare = gross > threshold ? (gross - threshold) * 0.009 : 0;
  return ss + medicareBase + additionalMedicare;
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
  gross: number;                       // person or household gross income for the period
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
}

export interface TotalTaxOutput {
  federal: number;
  fica: number;
  state: number;
  city: number;
  total: number;
  /** total / gross — 0 when gross is 0 */
  effectiveRate: number;
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

  const sd = normalizeStandardDeduction(input.standardDeduction);
  const federalTaxable = Math.max(0, input.gross - pretaxTotal - sd.federal);
  const stateTaxable = Math.max(0, input.gross - pretaxTotal - sd.state);
  const cityTaxable = Math.max(0, input.gross - pretaxTotal - sd.city);

  const federal = input.gross > 0 ? evaluateBrackets(input.federalBrackets, federalTaxable) : 0;
  const fica = computeFica(input.gross, input.filingStatus);
  const state = input.stateBrackets.length > 0 ? evaluateBrackets(input.stateBrackets, stateTaxable) : 0;
  const city = input.cityBrackets ? evaluateBrackets(input.cityBrackets, cityTaxable) : 0;
  const total = federal + fica + state + city;

  return {
    federal,
    fica,
    state,
    city,
    total,
    effectiveRate: input.gross > 0 ? total / input.gross : 0,
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

  const withBonus = computeTotalTax({
    gross: input.personGross,
    filingStatus: input.filingStatus,
    federalBrackets: input.federalBrackets,
    stateBrackets: input.stateBrackets,
    cityBrackets: input.cityBrackets,
    standardDeduction: input.standardDeduction,
    pretax: input.pretax,
  });

  const withoutBonus = computeTotalTax({
    gross: grossWithoutBonus,
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
  federalStandardDeduction: number;
  taxYear: number;
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

  const ordinaryWithoutWithdrawal = input.annualW2Income + input.annualCapitalGains;
  const adjustedWithout = Math.max(0, ordinaryWithoutWithdrawal - input.federalStandardDeduction);
  const adjustedWith = Math.max(0, ordinaryWithoutWithdrawal + input.withdrawalAmount - input.federalStandardDeduction);

  const federalWithout = evaluateBrackets(input.federalBrackets, adjustedWithout);
  const federalWith = evaluateBrackets(input.federalBrackets, adjustedWith);
  const incrementalFederal = federalWith - federalWithout;

  const stateWithout = input.stateBrackets.length > 0 ? evaluateBrackets(input.stateBrackets, adjustedWithout) : 0;
  const stateWith = input.stateBrackets.length > 0 ? evaluateBrackets(input.stateBrackets, adjustedWith) : 0;
  const incrementalState = stateWith - stateWithout;

  const cityWithout = input.cityBrackets ? evaluateBrackets(input.cityBrackets, adjustedWithout) : 0;
  const cityWith = input.cityBrackets ? evaluateBrackets(input.cityBrackets, adjustedWith) : 0;
  const incrementalCity = cityWith - cityWithout;

  const earlyWithdrawalPenalty = input.ageAtWithdrawal < 59.5 ? input.withdrawalAmount * 0.10 : 0;
  const totalTaxOnWithdrawal = incrementalFederal + incrementalState + incrementalCity + earlyWithdrawalPenalty;
  const netToUser = input.withdrawalAmount - totalTaxOnWithdrawal;
  const effectiveRate = input.withdrawalAmount > 0 ? totalTaxOnWithdrawal / input.withdrawalAmount : 0;

  return {
    incrementalFederal,
    incrementalState,
    incrementalCity,
    earlyWithdrawalPenalty,
    totalTaxOnWithdrawal,
    netToUser,
    effectiveRate,
  };
}
