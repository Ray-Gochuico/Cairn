import { describe, it, expect } from 'vitest';
import { evaluateBrackets, type Bracket, computeFica, computePretaxDeductions, computeBonusTax, computeTotalTax, type TotalTaxInput } from '@/lib/tax';

const federal2026Single: Bracket[] = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: 243725, rate: 0.32 },
  { min: 243725, max: 609350, rate: 0.35 },
  { min: 609350, max: null, rate: 0.37 },
];

describe('evaluateBrackets', () => {
  it('returns 0 for zero taxable income', () => {
    expect(evaluateBrackets(federal2026Single, 0)).toBe(0);
  });
  it('computes tax within the first bracket', () => {
    // 10% × 10000 = 1000
    expect(evaluateBrackets(federal2026Single, 10000)).toBeCloseTo(1000, 2);
  });
  it('crosses the first bracket boundary', () => {
    // 10% × 11600 = 1160; 12% × (20000 - 11600) = 1008; total 2168
    expect(evaluateBrackets(federal2026Single, 20000)).toBeCloseTo(2168, 2);
  });
  it('handles the $85.4k example (gross $100k − $14.6k std deduction)', () => {
    // 1160 + 12%×(47150-11600) + 22%×(85400-47150) = 1160 + 4266 + 8415 = 13841
    expect(evaluateBrackets(federal2026Single, 85400)).toBeCloseTo(13841, 0);
  });
  it('handles unbounded top bracket', () => {
    expect(evaluateBrackets(federal2026Single, 1000000)).toBeCloseTo(328187.75, 0);
  });
  it('rejects negative income', () => {
    expect(() => evaluateBrackets(federal2026Single, -1)).toThrow();
  });
});

describe('computeFica', () => {
  it('applies 6.2% SS + 1.45% Medicare for income below SS wage base', () => {
    // 100000 × 0.062 = 6200; 100000 × 0.0145 = 1450; total 7650
    expect(computeFica(100000, 'SINGLE')).toBeCloseTo(7650, 2);
  });
  it('caps SS at the 2026 wage base ($184,500)', () => {
    // SS: 184500 × 0.062 = 11439 (capped); Medicare: 200000 × 0.0145 = 2900; total 14339
    expect(computeFica(200000, 'SINGLE')).toBeCloseTo(14339, 1);
  });
  it('applies +0.9% Additional Medicare Tax above $200k SINGLE', () => {
    // 250000: SS capped = 11439; Medicare: 250000 × 0.0145 + (250000-200000) × 0.009 = 3625 + 450 = 4075; total 15514
    expect(computeFica(250000, 'SINGLE')).toBeCloseTo(15514, 1);
  });
  it('uses $250k MFJ threshold for Additional Medicare Tax', () => {
    // 300000 MFJ: SS capped = 11439; Medicare: 300000 × 0.0145 + (300000-250000) × 0.009 = 4350 + 450 = 4800
    // total: 11439 + 4800 = 16239
    expect(computeFica(300000, 'MFJ')).toBeCloseTo(16239, 1);
  });
});

describe('computePretaxDeductions', () => {
  it('caps 401k at $24,500', () => {
    const result = computePretaxDeductions({
      salary: 200000,
      pretax401kPct: 0.20,                        // 200k × 20% = 40k (over cap)
      healthInsuranceMonthlyPremium: 0,
      dcfsaMonthly: 0,
      hsaMonthly: 0,
      hsaEligible: false,
      filingStatus: 'SINGLE',
      personCount: 1,
      dependentCount: 0,
    });
    expect(result.pretax401k).toBe(24500);
  });
  it('caps DCFSA at $7.5k for SINGLE (OBBBA 2026)', () => {
    const result = computePretaxDeductions({
      salary: 100000, pretax401kPct: 0, healthInsuranceMonthlyPremium: 0,
      dcfsaMonthly: 1000,                         // 12k > 7.5k cap
      hsaMonthly: 0, hsaEligible: false,
      filingStatus: 'SINGLE', personCount: 1, dependentCount: 0,
    });
    expect(result.pretaxDcfsa).toBe(7500);
  });
  it('caps HSA at family limit when household has 2 persons', () => {
    const result = computePretaxDeductions({
      salary: 100000, pretax401kPct: 0, healthInsuranceMonthlyPremium: 0,
      dcfsaMonthly: 0,
      hsaMonthly: 1000,                           // 12k > 8750 family cap
      hsaEligible: true,
      filingStatus: 'MFJ', personCount: 2, dependentCount: 0,
    });
    expect(result.pretaxHsa).toBe(8750);
  });
  it('returns 0 HSA when not eligible regardless of monthly entry', () => {
    const result = computePretaxDeductions({
      salary: 100000, pretax401kPct: 0, healthInsuranceMonthlyPremium: 0,
      dcfsaMonthly: 0, hsaMonthly: 500, hsaEligible: false,
      filingStatus: 'SINGLE', personCount: 1, dependentCount: 0,
    });
    expect(result.pretaxHsa).toBe(0);
  });
});

describe('computeBonusTax', () => {
  const state: Bracket[] = [{ min: 0, max: null, rate: 0.05 }];
  const stdDeduction = 14600;

  it('produces a positive marginal rate on bonus', () => {
    const result = computeBonusTax({
      personGross: 100000,
      bonus: 20000,
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
      filingStatus: 'SINGLE',
      federalBrackets: federal2026Single,
      stateBrackets: state,
      cityBrackets: null,
      standardDeduction: stdDeduction,
    });
    expect(result.marginalRateOnBonus).toBeGreaterThan(0);
    expect(result.marginalRateOnBonus).toBeLessThan(1);
    expect(result.bonusTakeHome).toBeCloseTo(20000 * (1 - result.marginalRateOnBonus), 2);
  });

  it('Test A: zero-bonus path guards against division by zero', () => {
    const result = computeBonusTax({
      personGross: 100000,
      bonus: 0,
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
      filingStatus: 'SINGLE',
      federalBrackets: federal2026Single,
      stateBrackets: state,
      cityBrackets: null,
      standardDeduction: stdDeduction,
    });
    expect(result.marginalRateOnBonus).toBe(0);
    expect(result.bonusTakeHome).toBe(0);
  });

  it('Test B: anchors to known numeric scenario without city tax', () => {
    const result = computeBonusTax({
      personGross: 100000,
      bonus: 10000,
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
      filingStatus: 'SINGLE',
      federalBrackets: federal2026Single,
      stateBrackets: state,
      cityBrackets: null,
      standardDeduction: stdDeduction,
    });
    // Expected: marginal tax on bonus = 3465, marginal rate = 0.3465, take-home = 6535
    expect(result.marginalRateOnBonus).toBeCloseTo(0.3465, 3);
    expect(result.bonusTakeHome).toBeCloseTo(6535, 0);
  });

  it('Test C: anchors with city tax applied', () => {
    const city: Bracket[] = [{ min: 0, max: null, rate: 0.03 }];
    const result = computeBonusTax({
      personGross: 100000,
      bonus: 10000,
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
      filingStatus: 'SINGLE',
      federalBrackets: federal2026Single,
      stateBrackets: state,
      cityBrackets: city,
      standardDeduction: stdDeduction,
    });
    // City tax adds 3% to adjusted income; marginal rate should increase by ~0.03
    expect(result.cityTax).toBeGreaterThan(0);
    expect(result.marginalRateOnBonus).toBeGreaterThan(0.3465 + 0.025);
  });

  it('bonusBreakdown sums to marginalTaxOnBonus × bonus', () => {
    const result = computeBonusTax({
      personGross: 100000,
      bonus: 10000,
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
      filingStatus: 'SINGLE',
      federalBrackets: federal2026Single,
      stateBrackets: state,
      cityBrackets: null,
      standardDeduction: stdDeduction,
    });
    const sumOfBreakdown = result.bonusBreakdown.federal + result.bonusBreakdown.fica + result.bonusBreakdown.state + result.bonusBreakdown.city;
    expect(sumOfBreakdown).toBeCloseTo(result.bonusBreakdown.total, 4);
    expect(result.bonusBreakdown.total).toBeCloseTo(result.marginalRateOnBonus * 10000, 4);
  });

  it('bonusBreakdown.federal matches the marginal federal-tax diff', () => {
    // For our anchor scenario, federal bracket at $85.4k taxable lands in 22% tier.
    // Adding $10k bonus → adjusted goes from $75.4k to $85.4k (both in 22% tier for SINGLE).
    // Federal diff should be 22% × 10000 = $2,200.
    const result = computeBonusTax({
      personGross: 100000,
      bonus: 10000,
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
      filingStatus: 'SINGLE',
      federalBrackets: federal2026Single,
      stateBrackets: state,
      cityBrackets: null,
      standardDeduction: stdDeduction,
    });
    expect(result.bonusBreakdown.federal).toBeCloseTo(2200, 0);
    expect(result.bonusBreakdown.state).toBeCloseTo(500, 0);  // 5% × 10000
  });
});

describe('computeTotalTax', () => {
  // California 2026 single, simplified for fixture parity.
  const caSingle: Bracket[] = [
    { min: 0, max: 10412, rate: 0.01 },
    { min: 10412, max: 24684, rate: 0.02 },
    { min: 24684, max: 38959, rate: 0.04 },
    { min: 38959, max: 54081, rate: 0.06 },
    { min: 54081, max: 68350, rate: 0.08 },
    { min: 68350, max: 349137, rate: 0.093 },
    { min: 349137, max: null, rate: 0.103 },
  ];

  // No state tax — Texas.
  const txSingle: Bracket[] = [];

  // NYC resident, simplified.
  const nycResident: Bracket[] = [
    { min: 0, max: 12000, rate: 0.03078 },
    { min: 12000, max: 25000, rate: 0.03762 },
    { min: 25000, max: 50000, rate: 0.03819 },
    { min: 50000, max: null, rate: 0.03876 },
  ];

  const baseInput: Omit<TotalTaxInput, 'stateBrackets' | 'cityBrackets'> = {
    gross: 100000,
    filingStatus: 'SINGLE',
    federalBrackets: federal2026Single,
    standardDeduction: 14600,
    pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
  };

  it('SINGLE @ $100k CA: federal + FICA + state, no city', () => {
    const out = computeTotalTax({ ...baseInput, stateBrackets: caSingle, cityBrackets: null });
    expect(out.federal).toBeCloseTo(13841, 0);     // ~13.84% effective fed on $85,400 taxable
    expect(out.fica).toBeCloseTo(7650, 0);         // 7.65% on $100k gross
    expect(out.state).toBeGreaterThan(0);
    expect(out.city).toBe(0);
    expect(out.total).toBeCloseTo(out.federal + out.fica + out.state + out.city, 2);
  });

  it('SINGLE @ $100k TX: federal + FICA only (no state, no city)', () => {
    const out = computeTotalTax({ ...baseInput, stateBrackets: txSingle, cityBrackets: null });
    expect(out.state).toBe(0);
    expect(out.city).toBe(0);
    expect(out.total).toBeCloseTo(out.federal + out.fica, 2);
  });

  it('SINGLE @ $100k NYC (NY state + NYC city): all four components positive', () => {
    const out = computeTotalTax({
      ...baseInput,
      stateBrackets: caSingle,  // reusing as a "state with brackets" fixture
      cityBrackets: nycResident,
    });
    expect(out.federal).toBeGreaterThan(0);
    expect(out.fica).toBeGreaterThan(0);
    expect(out.state).toBeGreaterThan(0);
    expect(out.city).toBeGreaterThan(0);
  });

  it('Pretax deductions reduce taxable income before bracket math', () => {
    const noPretax = computeTotalTax({ ...baseInput, stateBrackets: txSingle, cityBrackets: null });
    const withPretax = computeTotalTax({
      ...baseInput,
      pretax: { pretax401k: 15000, pretaxHealth: 3000, pretaxDcfsa: 0, pretaxHsa: 0 },
      stateBrackets: txSingle,
      cityBrackets: null,
    });
    // Federal should drop; FICA is computed on gross so it stays.
    expect(withPretax.federal).toBeLessThan(noPretax.federal);
  });

  it('Zero / negative gross still produces a sensible result (no NaN, no throw)', () => {
    const out = computeTotalTax({ ...baseInput, gross: 0, stateBrackets: txSingle, cityBrackets: null });
    expect(out.federal).toBe(0);
    expect(out.total).toBeCloseTo(out.fica, 2); // FICA still computed on 0 gross = 0
  });
});
