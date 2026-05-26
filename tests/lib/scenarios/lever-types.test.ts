import { describe, it, expect } from 'vitest';
import {
  LeverPayloadSchema,
  emptyLeverPayload,
  IncomeEventSchema,
  type LeverPayload,
} from '@/lib/scenarios/lever-types';
import { CompoundingFrequency } from '@/types/enums';

describe('LeverPayloadSchema', () => {
  it('accepts an empty payload', () => {
    expect(() => LeverPayloadSchema.parse(emptyLeverPayload())).not.toThrow();
  });

  it('parses a fully-populated payload', () => {
    const payload: LeverPayload = {
      extraLoanPayments: [{ loanId: 1, extraMonthly: 300 }],
      lumpSums: [{ when: '2030-06-01', amount: 25000, destination: 'investments', label: 'Inheritance' }],
      expensePeriods: [{ start: '2026-07-01', monthlyDelta: 1500, durationMonths: 6, label: 'Medical' }],
      returns: {
        defaultRate: 0.07,
        overrides: { 2027: -0.15, 2028: 0.2 } as unknown as Record<string, number>,
        cashRate: null,
        compoundingFrequency: CompoundingFrequency.MONTHLY,
      },
      income: { perPerson: [{ annualRaiseRate: 0.03, events: [] }] },
      contributions: [{ startMonth: 0, endMonth: 59, monthlyAmount: 1000, label: 'Year 1-5', allocation: null }],
      retirementAgeOverride: null,
      swrOverride: null,
      inflation: { defaultRate: null, overrides: {} },
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

describe('ContributionSegmentSchema — allocation field', () => {
  const baseSegment = { startMonth: 0, endMonth: 11, monthlyAmount: 1000 };

  it('defaults allocation to null when omitted', () => {
    const seg = LeverPayloadSchema.parse({
      ...emptyLeverPayload(),
      contributions: [baseSegment],
    }).contributions[0];
    expect(seg.allocation).toBeNull();
  });

  it('accepts explicit null allocation', () => {
    const seg = LeverPayloadSchema.parse({
      ...emptyLeverPayload(),
      contributions: [{ ...baseSegment, allocation: null }],
    }).contributions[0];
    expect(seg.allocation).toBeNull();
  });

  it('accepts a valid allocation map that sums to 1', () => {
    const seg = LeverPayloadSchema.parse({
      ...emptyLeverPayload(),
      contributions: [{ ...baseSegment, allocation: { '1': 0.6, '2': 0.4 } }],
    }).contributions[0];
    expect(seg.allocation).toEqual({ '1': 0.6, '2': 0.4 });
  });

  it('rejects an allocation map whose proportions do not sum to 1', () => {
    expect(() =>
      LeverPayloadSchema.parse({
        ...emptyLeverPayload(),
        contributions: [{ ...baseSegment, allocation: { '1': 0.6, '2': 0.5 } }],
      }),
    ).toThrow();
  });

  it('rejects an allocation map with a proportion > 1', () => {
    expect(() =>
      LeverPayloadSchema.parse({
        ...emptyLeverPayload(),
        contributions: [{ ...baseSegment, allocation: { '1': 1.5 } }],
      }),
    ).toThrow();
  });

  it('rejects an allocation map with a negative proportion', () => {
    expect(() =>
      LeverPayloadSchema.parse({
        ...emptyLeverPayload(),
        contributions: [{ ...baseSegment, allocation: { '1': -0.1, '2': 1.1 } }],
      }),
    ).toThrow();
  });

  it('preserves Track 2 swrOverride field (regression guard)', () => {
    expect(emptyLeverPayload()).toHaveProperty('swrOverride', null);
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

describe('ReturnScheduleSchema — cashRate field', () => {
  it('emptyLeverPayload has cashRate: null on returns', () => {
    expect(emptyLeverPayload().returns.cashRate).toBeNull();
  });

  it('accepts cashRate: null', () => {
    const payload = LeverPayloadSchema.parse({
      ...emptyLeverPayload(),
      returns: { defaultRate: 0.07, overrides: {}, cashRate: null },
    });
    expect(payload.returns.cashRate).toBeNull();
  });

  it('accepts cashRate: 0', () => {
    const payload = LeverPayloadSchema.parse({
      ...emptyLeverPayload(),
      returns: { defaultRate: 0.07, overrides: {}, cashRate: 0 },
    });
    expect(payload.returns.cashRate).toBe(0);
  });

  it('accepts cashRate: 0.045', () => {
    const payload = LeverPayloadSchema.parse({
      ...emptyLeverPayload(),
      returns: { defaultRate: 0.07, overrides: {}, cashRate: 0.045 },
    });
    expect(payload.returns.cashRate).toBeCloseTo(0.045, 6);
  });

  it('accepts cashRate: 0.15 (upper bound)', () => {
    const payload = LeverPayloadSchema.parse({
      ...emptyLeverPayload(),
      returns: { defaultRate: 0.07, overrides: {}, cashRate: 0.15 },
    });
    expect(payload.returns.cashRate).toBe(0.15);
  });

  it('rejects cashRate: 0.2 (out of range)', () => {
    expect(() =>
      LeverPayloadSchema.parse({
        ...emptyLeverPayload(),
        returns: { defaultRate: 0.07, overrides: {}, cashRate: 0.2 },
      }),
    ).toThrow();
  });

  it('rejects cashRate: -0.01 (negative)', () => {
    expect(() =>
      LeverPayloadSchema.parse({
        ...emptyLeverPayload(),
        returns: { defaultRate: 0.07, overrides: {}, cashRate: -0.01 },
      }),
    ).toThrow();
  });

  it('defaults cashRate to null when returns is parsed without it (backward compat)', () => {
    const payload = LeverPayloadSchema.parse({
      ...emptyLeverPayload(),
      returns: { defaultRate: 0.07, overrides: {} },
    });
    expect(payload.returns.cashRate).toBeNull();
  });
});
