import { describe, it, expect } from 'vitest';
import { computePaycheck } from '@/lib/calculators/paycheck';
import { computeTotalTax, computeHouseholdFica } from '@/lib/tax';
import { computeTakeHome } from '@/lib/paycheck-takehome';
import { FilingStatus } from '@/types/enums';

// Wave 15 Task 1: the ONE paycheck composition engine. PaycheckCard used to
// run computeBonusTax({bonus: 0}) while PaycheckCalculator hand-composed
// computeTotalTax + computeHouseholdFica + computeTakeHome — two engines that
// could drift. This suite locks the composition; the card/page component
// suites lock that both consumers produce byte-identical numbers to before.

const federalBrackets = [
  { min: 0, max: 50_000, rate: 0.1 },
  { min: 50_000, max: null, rate: 0.2 },
];
const stateBrackets = [{ min: 0, max: null, rate: 0.05 }];
// Real seeded shape for no-income-tax states (TX/FL/NV/...): a single
// ZERO-RATE bracket, NEVER [] (schema requires >=1 bracket). Detection must
// use rate > 0, not length.
const noTaxStateBrackets = [{ min: 0, max: null, rate: 0 }];
const sd = { federal: 15_000, state: 0, city: 0 };
const noPretax = { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 };

// NOT `as const` — PaycheckInput takes mutable number[]/Bracket[] arrays.
const base = {
  gross: 100_000,
  perPersonGross: [100_000],
  filingStatus: FilingStatus.SINGLE,
  federalBrackets,
  stateBrackets,
  cityBrackets: null as null,
  standardDeduction: sd,
  pretax: noPretax,
};

describe('computePaycheck', () => {
  it('composes computeTotalTax + computeHouseholdFica + computeTakeHome exactly', () => {
    const r = computePaycheck({ ...base });
    const tax = computeTotalTax({ ...base });
    const fica = computeHouseholdFica([100_000], FilingStatus.SINGLE);
    expect(r.federal).toBe(tax.federal);
    expect(r.stateTax).toBe(tax.state);
    expect(r.cityTax).toBe(tax.city);
    expect(r.fica).toBe(tax.fica);
    expect(r.ss).toBe(fica.socialSecurity);
    expect(r.medicare).toBe(fica.medicare);
    expect(r.additionalMedicare).toBe(fica.additionalMedicare);
    expect(r.takeHome).toBe(
      computeTakeHome({
        gross: 100_000,
        pretaxTotal: 0,
        taxTotal: tax.total,
        postTaxTotal: 0,
        extraWithholdingTotal: 0,
      }),
    );
  });

  it('post-tax and extra-withholding reduce take-home dollar-for-dollar', () => {
    const plain = computePaycheck({ ...base });
    const loaded = computePaycheck({ ...base, postTaxAnnual: 6_000, extraWithholdingAnnual: 1_200 });
    expect(loaded.takeHome).toBeCloseTo(plain.takeHome - 7_200, 6);
    expect(loaded.postTaxTotal).toBe(6_000);
    expect(loaded.extraWithholdingTotal).toBe(1_200);
  });

  it('detects no-state-tax via the zero-rate bracket shape, never .length', () => {
    const r = computePaycheck({ ...base, stateBrackets: noTaxStateBrackets });
    expect(r.hasStateTax).toBe(false);
    expect(r.stateTax).toBe(0);
    const taxed = computePaycheck({ ...base });
    expect(taxed.hasStateTax).toBe(true);
  });

  it('splits FICA per earner: two $150k earners owe MORE SS than one $300k earner (per-earner wage bases)', () => {
    const two = computePaycheck({ ...base, gross: 300_000, perPersonGross: [150_000, 150_000], filingStatus: FilingStatus.MFJ });
    const one = computePaycheck({ ...base, gross: 300_000, perPersonGross: [300_000], filingStatus: FilingStatus.MFJ });
    expect(two.ss).toBeGreaterThan(one.ss); // one earner caps at the wage base; two don't
  });

  it('pretax lowers taxable income and appears itemized + totaled in the result', () => {
    const pretax = { pretax401k: 10_000, pretaxHealth: 3_600, pretaxDcfsa: 0, pretaxHsa: 0 };
    const r = computePaycheck({ ...base, pretax });
    expect(r.pretax401k).toBe(10_000);
    expect(r.pretaxHealth).toBe(3_600);
    expect(r.pretaxTotal).toBe(13_600);
    expect(r.federal).toBeLessThan(computePaycheck({ ...base }).federal);
  });
});
