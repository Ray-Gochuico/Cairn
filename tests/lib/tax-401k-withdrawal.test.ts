import { describe, it, expect } from 'vitest';
import {
  calculate401kWithdrawalTax,
  type Bracket,
} from '@/lib/tax';

// Federal 2026 SINGLE brackets (subset — enough for these fixtures)
const FED_SINGLE_2026: Bracket[] = [
  { min: 0,       max: 11_600,  rate: 0.10 },
  { min: 11_600,  max: 47_150,  rate: 0.12 },
  { min: 47_150,  max: 100_525, rate: 0.22 },
  { min: 100_525, max: 191_950, rate: 0.24 },
  { min: 191_950, max: 243_725, rate: 0.32 },
  { min: 243_725, max: 609_350, rate: 0.35 },
  { min: 609_350, max: null,    rate: 0.37 },
];

const FED_MFJ_2026: Bracket[] = [
  { min: 0,        max: 23_200,  rate: 0.10 },
  { min: 23_200,   max: 94_300,  rate: 0.12 },
  { min: 94_300,   max: 201_050, rate: 0.22 },
  { min: 201_050,  max: 383_900, rate: 0.24 },
  { min: 383_900,  max: 487_450, rate: 0.32 },
  { min: 487_450,  max: 731_200, rate: 0.35 },
  { min: 731_200,  max: null,    rate: 0.37 },
];

const STATE_TX_NONE: Bracket[] = [];
const STATE_NC_FLAT: Bracket[] = [{ min: 0, max: null, rate: 0.045 }];
const STATE_CA_2026: Bracket[] = [
  { min: 0,         max: 21_512,    rate: 0.010 },
  { min: 21_512,    max: 50_998,    rate: 0.020 },
  { min: 50_998,    max: 80_490,    rate: 0.040 },
  { min: 80_490,    max: 111_732,   rate: 0.060 },
  { min: 111_732,   max: 141_212,   rate: 0.080 },
  { min: 141_212,   max: 721_318,   rate: 0.093 },
  { min: 721_318,   max: 865_574,   rate: 0.103 },
  { min: 865_574,   max: 1_442_628, rate: 0.113 },
  { min: 1_442_628, max: null,      rate: 0.123 },
];
const CITY_NYC_2026: Bracket[] = [
  { min: 0,      max: 12_000, rate: 0.03078 },
  { min: 12_000, max: 25_000, rate: 0.03762 },
  { min: 25_000, max: 50_000, rate: 0.03819 },
  { min: 50_000, max: null,   rate: 0.03876 },
];

const FED_STD_SINGLE = 14_600;
const FED_STD_MFJ = 29_200;

const baseInput = {
  annualW2Income: 120_000,
  annualCapitalGains: 0,
  filingStatus: 'SINGLE' as const,
  federalBrackets: FED_SINGLE_2026,
  stateBrackets: STATE_CA_2026,
  cityBrackets: null,
  federalStandardDeduction: FED_STD_SINGLE,
  taxYear: 2026,
};

describe('calculate401kWithdrawalTax — penalty rules', () => {
  it('applies the 10% early-withdrawal penalty when age < 59.5', () => {
    const r = calculate401kWithdrawalTax({ ...baseInput, withdrawalAmount: 50_000, ageAtWithdrawal: 45 });
    expect(r.earlyWithdrawalPenalty).toBeCloseTo(5_000, 2);
  });

  it('exactly 59.5 — no penalty', () => {
    const r = calculate401kWithdrawalTax({ ...baseInput, withdrawalAmount: 50_000, ageAtWithdrawal: 59.5 });
    expect(r.earlyWithdrawalPenalty).toBe(0);
  });

  it('above 59.5 — no penalty', () => {
    const r = calculate401kWithdrawalTax({ ...baseInput, withdrawalAmount: 50_000, ageAtWithdrawal: 67 });
    expect(r.earlyWithdrawalPenalty).toBe(0);
  });
});

describe('calculate401kWithdrawalTax — filing status', () => {
  it('MFJ filers see a smaller federal increment than SINGLE at the same income (wider brackets)', () => {
    const single = calculate401kWithdrawalTax({
      ...baseInput,
      withdrawalAmount: 40_000,
      ageAtWithdrawal: 67,
      filingStatus: 'SINGLE',
      federalBrackets: FED_SINGLE_2026,
      federalStandardDeduction: FED_STD_SINGLE,
      stateBrackets: STATE_TX_NONE,
    });
    const mfj = calculate401kWithdrawalTax({
      ...baseInput,
      withdrawalAmount: 40_000,
      ageAtWithdrawal: 67,
      filingStatus: 'MFJ',
      federalBrackets: FED_MFJ_2026,
      federalStandardDeduction: FED_STD_MFJ,
      stateBrackets: STATE_TX_NONE,
    });
    expect(mfj.incrementalFederal).toBeLessThan(single.incrementalFederal);
  });
});

describe('calculate401kWithdrawalTax — state coverage', () => {
  const common = {
    withdrawalAmount: 40_000,
    annualW2Income: 120_000,
    annualCapitalGains: 0,
    ageAtWithdrawal: 67,
    filingStatus: 'SINGLE' as const,
    federalBrackets: FED_SINGLE_2026,
    cityBrackets: null,
    federalStandardDeduction: FED_STD_SINGLE,
    taxYear: 2026,
  };

  it('TX (no state tax) — incrementalState is 0', () => {
    const r = calculate401kWithdrawalTax({ ...common, stateBrackets: STATE_TX_NONE });
    expect(r.incrementalState).toBe(0);
  });

  it('NC (flat 4.5%) — incrementalState equals 4.5% of the withdrawal', () => {
    const r = calculate401kWithdrawalTax({ ...common, stateBrackets: STATE_NC_FLAT });
    expect(r.incrementalState).toBeCloseTo(40_000 * 0.045, 0);
  });

  it('CA (brackets) — incrementalState is positive but below the marginal rate × withdrawal', () => {
    const r = calculate401kWithdrawalTax({ ...common, stateBrackets: STATE_CA_2026 });
    expect(r.incrementalState).toBeGreaterThan(0);
    expect(r.incrementalState).toBeLessThan(40_000 * 0.093);
  });
});

describe('calculate401kWithdrawalTax — city coverage', () => {
  it('NYC (top bracket 3.876%) — incrementalCity ≈ 3.876% × withdrawal at high income', () => {
    const r = calculate401kWithdrawalTax({
      withdrawalAmount: 50_000,
      annualW2Income: 200_000,
      annualCapitalGains: 0,
      ageAtWithdrawal: 67,
      filingStatus: 'SINGLE',
      federalBrackets: FED_SINGLE_2026,
      stateBrackets: STATE_CA_2026,
      cityBrackets: CITY_NYC_2026,
      federalStandardDeduction: FED_STD_SINGLE,
      taxYear: 2026,
    });
    expect(r.incrementalCity).toBeGreaterThan(0);
    expect(r.incrementalCity).toBeLessThanOrEqual(50_000 * 0.03876 + 1);
  });
});

describe('calculate401kWithdrawalTax — output shape', () => {
  it('net + total = withdrawal', () => {
    const r = calculate401kWithdrawalTax({ ...baseInput, withdrawalAmount: 50_000, ageAtWithdrawal: 67 });
    expect(r.netToUser + r.totalTaxOnWithdrawal).toBeCloseTo(50_000, 5);
  });

  it('effectiveRate equals totalTax / withdrawal', () => {
    const r = calculate401kWithdrawalTax({ ...baseInput, withdrawalAmount: 50_000, ageAtWithdrawal: 67 });
    expect(r.effectiveRate).toBeCloseTo(r.totalTaxOnWithdrawal / 50_000, 6);
  });

  it('withdrawalAmount = 0 yields zeros and a zero effective rate', () => {
    const r = calculate401kWithdrawalTax({ ...baseInput, withdrawalAmount: 0, ageAtWithdrawal: 67 });
    expect(r.totalTaxOnWithdrawal).toBe(0);
    expect(r.netToUser).toBe(0);
    expect(r.effectiveRate).toBe(0);
  });

  it('throws on negative withdrawalAmount', () => {
    expect(() =>
      calculate401kWithdrawalTax({ ...baseInput, withdrawalAmount: -1, ageAtWithdrawal: 67 }),
    ).toThrow();
  });
});
