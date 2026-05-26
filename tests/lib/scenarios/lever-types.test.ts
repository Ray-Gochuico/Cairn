import { describe, it, expect } from 'vitest';
import {
  LeverPayloadSchema,
  emptyLeverPayload,
  IncomeEventSchema,
  type LeverPayload,
} from '@/lib/scenarios/lever-types';

describe('LeverPayloadSchema', () => {
  it('accepts an empty payload', () => {
    expect(() => LeverPayloadSchema.parse(emptyLeverPayload())).not.toThrow();
  });

  it('parses a fully-populated payload', () => {
    const payload: LeverPayload = {
      extraLoanPayments: [{ loanId: 1, extraMonthly: 300 }],
      lumpSums: [{ when: '2030-06-01', amount: 25000, destination: 'investments', label: 'Inheritance' }],
      expensePeriods: [{ start: '2026-07-01', monthlyDelta: 1500, durationMonths: 6, label: 'Medical' }],
      returns: { defaultRate: 0.07, overrides: { 2027: -0.15, 2028: 0.2 } as unknown as Record<string, number> },
      income: { perPerson: [{ annualRaiseRate: 0.03, events: [] }] },
      contributions: [{ startMonth: 0, endMonth: 59, monthlyAmount: 1000, label: 'Year 1-5' }],
      retirementAgeOverride: null,
      swrOverride: null,
    };
    expect(LeverPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('defaults contributions to an empty array when omitted (back-compat)', () => {
    const partial = {
      extraLoanPayments: [],
      lumpSums: [],
      expensePeriods: [],
      returns: { defaultRate: 0.07, overrides: {} },
      income: { perPerson: [{ annualRaiseRate: 0, events: [] }] },
    };
    const parsed = LeverPayloadSchema.parse(partial);
    expect(parsed.contributions).toEqual([]);
    expect(parsed.retirementAgeOverride).toBeNull();
  });

  it('rejects a contribution segment with negative monthlyAmount', () => {
    const bad = {
      ...emptyLeverPayload(),
      contributions: [{ startMonth: 0, endMonth: 11, monthlyAmount: -100 }],
    };
    expect(() => LeverPayloadSchema.parse(bad)).toThrow();
  });

  it('accepts an open-ended contribution segment (endMonth = null)', () => {
    const payload = {
      ...emptyLeverPayload(),
      contributions: [{ startMonth: 120, endMonth: null, monthlyAmount: 2000 }],
    };
    expect(() => LeverPayloadSchema.parse(payload)).not.toThrow();
  });

  it('rejects an unknown destination', () => {
    const bad = { ...emptyLeverPayload(), lumpSums: [{ when: '2030-06-01', amount: 25000, destination: 'crypto' }] };
    expect(() => LeverPayloadSchema.parse(bad)).toThrow();
  });
});

describe('LeverPayloadSchema — swrOverride', () => {
  it('emptyLeverPayload sets swrOverride to null', () => {
    expect(emptyLeverPayload().swrOverride).toBeNull();
  });

  it('accepts swrOverride values between 0.005 and 0.15', () => {
    const base = emptyLeverPayload();
    expect(LeverPayloadSchema.parse({ ...base, swrOverride: 0.035 }).swrOverride).toBe(0.035);
    expect(LeverPayloadSchema.parse({ ...base, swrOverride: 0.005 }).swrOverride).toBe(0.005);
    expect(LeverPayloadSchema.parse({ ...base, swrOverride: 0.15 }).swrOverride).toBe(0.15);
  });

  it('accepts swrOverride: null', () => {
    expect(LeverPayloadSchema.parse({ ...emptyLeverPayload(), swrOverride: null }).swrOverride).toBeNull();
  });

  it('rejects swrOverride outside the 0.005–0.15 range', () => {
    const base = emptyLeverPayload();
    expect(() => LeverPayloadSchema.parse({ ...base, swrOverride: 0 })).toThrow();
    expect(() => LeverPayloadSchema.parse({ ...base, swrOverride: 0.2 })).toThrow();
    expect(() => LeverPayloadSchema.parse({ ...base, swrOverride: -0.01 })).toThrow();
  });

  it('defaults swrOverride to null when omitted on parse', () => {
    const { swrOverride: _drop, ...withoutSwr } = emptyLeverPayload();
    expect(LeverPayloadSchema.parse(withoutSwr).swrOverride).toBeNull();
  });
});

describe('IncomeEventSchema discriminated union', () => {
  it('parses a promotion event', () => {
    const ev = { when: '2028-04-01', type: 'promotion', newSalary: 168000, label: 'Senior promo' };
    expect(IncomeEventSchema.parse(ev)).toEqual(ev);
  });

  it('parses a sabbatical event with duration', () => {
    const ev = { when: '2034-07-01', type: 'sabbatical', durationMonths: 6 };
    expect(IncomeEventSchema.parse(ev)).toEqual(ev);
  });

  it('rejects a promotion missing newSalary', () => {
    expect(() => IncomeEventSchema.parse({ when: '2028-04-01', type: 'promotion' })).toThrow();
  });
});
