import { describe, it, expect } from 'vitest';
import {
  computeLtcgTax,
  computeNiit,
  computeTotalTax,
  type Bracket,
  type LtcgInput,
  type NiitInput,
} from '@/lib/tax';

// 2026 LTCG brackets per Tax Foundation 2026 (IRS Rev. Proc. 2025-32).
// Single: 0% to $49,450; 15% to $545,500; 20% above.
// MFJ:    0% to $98,900; 15% to $613,700; 20% above.
// HOH:    0% to $66,200; 15% to $579,600; 20% above.
const LTCG_2026_SINGLE: Bracket[] = [
  { min: 0,       max: 49450,  rate: 0.0 },
  { min: 49450,   max: 545500, rate: 0.15 },
  { min: 545500,  max: null,   rate: 0.20 },
];
const LTCG_2026_MFJ: Bracket[] = [
  { min: 0,       max: 98900,  rate: 0.0 },
  { min: 98900,   max: 613700, rate: 0.15 },
  { min: 613700,  max: null,   rate: 0.20 },
];

describe('computeLtcgTax — 2026 brackets', () => {
  it('returns 0 when long-term gains + qualified dividends are zero', () => {
    const out = computeLtcgTax({
      ordinaryIncome: 100_000,
      longTermGains: 0,
      qualifiedDividends: 0,
      ltcgBrackets: LTCG_2026_SINGLE,
      filingStatus: 'SINGLE',
    });
    expect(out.federalLtcgTax).toBe(0);
  });

  it('SINGLE $40k ordinary + $20k LTCG: gains stack on top of ordinary; all $20k taxed at 0% (still under $49,450 stack)', () => {
    // Stack: ordinary $40k + gains $20k = $60k. LTCG portion sits in the
    // 0% bracket from $40k -> $49,450 ($9,450 at 0%) and the 15% bracket
    // from $49,450 -> $60k ($10,550 at 15%) = $1,582.50.
    const out = computeLtcgTax({
      ordinaryIncome: 40_000,
      longTermGains: 20_000,
      qualifiedDividends: 0,
      ltcgBrackets: LTCG_2026_SINGLE,
      filingStatus: 'SINGLE',
    });
    expect(out.federalLtcgTax).toBeCloseTo(9450 * 0 + 10550 * 0.15, 2);
  });

  it('MFJ $50k LTCG entirely under $98,900 0% threshold → tax = $0', () => {
    const out = computeLtcgTax({
      ordinaryIncome: 0,
      longTermGains: 50_000,
      qualifiedDividends: 0,
      ltcgBrackets: LTCG_2026_MFJ,
      filingStatus: 'MFJ',
    });
    expect(out.federalLtcgTax).toBe(0);
  });

  it('MFJ $200k ordinary + $50k LTCG: gains stack from $200k to $250k → all in 15% bracket = $7,500', () => {
    // Concrete example from the Finance review (finding #5).
    // Pre-fix: treated as ordinary 22%/24% → ~$11,500. Correct: $7,500.
    const out = computeLtcgTax({
      ordinaryIncome: 200_000,
      longTermGains: 50_000,
      qualifiedDividends: 0,
      ltcgBrackets: LTCG_2026_MFJ,
      filingStatus: 'MFJ',
    });
    expect(out.federalLtcgTax).toBeCloseTo(7500, 0);
  });

  it('qualifiedDividends are taxed at the LTCG schedule alongside long-term gains', () => {
    // $50k LTCG + $20k qual divs = $70k of qualified income. Stack at $200k
    // ordinary → all of $70k sits in the 15% bracket = $10,500.
    const out = computeLtcgTax({
      ordinaryIncome: 200_000,
      longTermGains: 50_000,
      qualifiedDividends: 20_000,
      ltcgBrackets: LTCG_2026_MFJ,
      filingStatus: 'MFJ',
    });
    expect(out.federalLtcgTax).toBeCloseTo(10500, 0);
  });

  it('top bracket: SINGLE $700k ordinary + $100k LTCG → 20% on full $100k = $20,000', () => {
    const out = computeLtcgTax({
      ordinaryIncome: 700_000,
      longTermGains: 100_000,
      qualifiedDividends: 0,
      ltcgBrackets: LTCG_2026_SINGLE,
      filingStatus: 'SINGLE',
    });
    expect(out.federalLtcgTax).toBeCloseTo(20_000, 0);
  });
});

describe('computeNiit — 3.8% on net investment income above MAGI threshold', () => {
  it('SINGLE MAGI $250k, investment income $50k → NIIT on lesser of $50k (II) or $50k (MAGI-200k) = 3.8% × $50k = $1,900', () => {
    const out = computeNiit({
      magi: 250_000,
      netInvestmentIncome: 50_000,
      filingStatus: 'SINGLE',
    });
    expect(out.niit).toBeCloseTo(1900, 2);
  });

  it('MFJ MAGI $300k, investment income $80k → lesser of $80k or ($300k-$250k=$50k) → 3.8% × $50k = $1,900', () => {
    const out = computeNiit({
      magi: 300_000,
      netInvestmentIncome: 80_000,
      filingStatus: 'MFJ',
    });
    expect(out.niit).toBeCloseTo(1900, 2);
  });

  it('MFJ MAGI $250k (at threshold), any II → NIIT = 0', () => {
    const out = computeNiit({
      magi: 250_000,
      netInvestmentIncome: 100_000,
      filingStatus: 'MFJ',
    });
    expect(out.niit).toBe(0);
  });

  it('SINGLE MAGI below $200k threshold → NIIT = 0 even with large II', () => {
    const out = computeNiit({
      magi: 150_000,
      netInvestmentIncome: 75_000,
      filingStatus: 'SINGLE',
    });
    expect(out.niit).toBe(0);
  });

  it('MFS threshold is $125k', () => {
    const out = computeNiit({
      magi: 150_000,
      netInvestmentIncome: 30_000,
      filingStatus: 'MFS',
    });
    // lesser of $30k II or ($150k - $125k = $25k) → 3.8% × $25k = $950
    expect(out.niit).toBeCloseTo(950, 2);
  });

  it('HOH threshold is $200k (same as SINGLE)', () => {
    const out = computeNiit({
      magi: 220_000,
      netInvestmentIncome: 40_000,
      filingStatus: 'HOH',
    });
    // lesser of $40k II or $20k excess → 3.8% × $20k = $760
    expect(out.niit).toBeCloseTo(760, 2);
  });
});

describe('computeTotalTax — accepts longTermGains + qualifiedDividends + nonQualifiedDividends', () => {
  const federal2026Mfj: Bracket[] = [
    { min: 0,       max: 24_800,  rate: 0.10 },
    { min: 24_800,  max: 100_800, rate: 0.12 },
    { min: 100_800, max: 211_400, rate: 0.22 },
    { min: 211_400, max: 403_550, rate: 0.24 },
    { min: 403_550, max: 512_450, rate: 0.32 },
    { min: 512_450, max: 768_700, rate: 0.35 },
    { min: 768_700, max: null,    rate: 0.37 },
  ];

  it('MFJ $200k W-2 + $50k LTCG: federal totals ordinary-on-$200k + LTCG-on-$50k + NIIT-on-applicable', () => {
    // Pre-Task-3: all $250k taxed as ordinary on a $250k bracket math.
    // Post-Task-3:
    //   ordinary federal = brackets($200k - $32,200 SD) = brackets($167,800)
    //     = 10%×24800 + 12%×(100800-24800) + 22%×(167800-100800)
    //     = 2480 + 9120 + 14740 = 26340
    //   ltcg federal = stack $200k -> $250k → MFJ 15% bracket from $98,900 up
    //     → entire $50k taxed at 15% = $7,500
    //   NIIT: MAGI $250k vs threshold $250k → 0
    // total federal = 26340 + 7500 = 33840
    const out = computeTotalTax({
      gross: 200_000,
      longTermGains: 50_000,
      qualifiedDividends: 0,
      nonQualifiedDividends: 0,
      ltcgBrackets: LTCG_2026_MFJ,
      filingStatus: 'MFJ',
      federalBrackets: federal2026Mfj,
      stateBrackets: [],
      cityBrackets: null,
      standardDeduction: { federal: 32_200, state: 0, city: 0 },
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
    });
    expect(out.federal).toBeCloseTo(26340 + 7500, 0);
    expect(out.niit).toBe(0);
  });

  it('MFJ $250k W-2 + $50k LTCG: MAGI $300k → NIIT applies', () => {
    // niit = 3.8% × min($50k II, $300k - $250k = $50k) = $1,900
    const out = computeTotalTax({
      gross: 250_000,
      longTermGains: 50_000,
      qualifiedDividends: 0,
      nonQualifiedDividends: 0,
      ltcgBrackets: LTCG_2026_MFJ,
      filingStatus: 'MFJ',
      federalBrackets: federal2026Mfj,
      stateBrackets: [],
      cityBrackets: null,
      standardDeduction: { federal: 32_200, state: 0, city: 0 },
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
    });
    expect(out.niit).toBeCloseTo(1900, 1);
  });

  it('backward-compatible: omitting LTCG fields preserves existing ordinary-only behavior', () => {
    const out = computeTotalTax({
      gross: 100_000,
      filingStatus: 'SINGLE',
      federalBrackets: [{ min: 0, max: null, rate: 0.22 }],
      stateBrackets: [],
      cityBrackets: null,
      standardDeduction: 16_100,
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
    });
    // federal = 22% × ($100k - $16,100) = 22% × $83,900 = $18,458
    expect(out.federal).toBeCloseTo(18_458, 0);
    expect(out.niit).toBe(0);
  });

  it('nonQualifiedDividends stack into ordinary income (taxed at ordinary brackets)', () => {
    // SINGLE: $50k W-2 + $10k non-qualified divs = $60k ordinary,
    //         $0 LTCG. SD = $16,100 → ordinary taxable = $43,900.
    const out = computeTotalTax({
      gross: 50_000,
      longTermGains: 0,
      qualifiedDividends: 0,
      nonQualifiedDividends: 10_000,
      filingStatus: 'SINGLE',
      federalBrackets: [
        { min: 0, max: 50_000, rate: 0.10 },
        { min: 50_000, max: null, rate: 0.22 },
      ],
      stateBrackets: [],
      cityBrackets: null,
      standardDeduction: 16_100,
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
    });
    // ordinary stack = $50k + $10k = $60k; taxable = $60k - $16.1k = $43.9k (in 10% bracket)
    // federal = 10% × $43,900 = $4,390 (rounding aside)
    expect(out.federal).toBeCloseTo(4390, 0);
  });
});

// Reflect the imported types so the test file enforces their shape
const _ltcgShape: LtcgInput = {
  ordinaryIncome: 0,
  longTermGains: 0,
  qualifiedDividends: 0,
  ltcgBrackets: [],
  filingStatus: 'SINGLE',
};
void _ltcgShape;

const _niitShape: NiitInput = {
  magi: 0,
  netInvestmentIncome: 0,
  filingStatus: 'SINGLE',
};
void _niitShape;
