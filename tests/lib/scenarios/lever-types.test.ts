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
    };
    expect(LeverPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('rejects an unknown destination', () => {
    const bad = { ...emptyLeverPayload(), lumpSums: [{ when: '2030-06-01', amount: 25000, destination: 'crypto' }] };
    expect(() => LeverPayloadSchema.parse(bad)).toThrow();
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
