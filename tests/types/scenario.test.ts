import { describe, it, expect } from 'vitest';
import { ScenarioSchema, type Scenario } from '@/types/scenario';
import { emptyLeverPayload } from '@/lib/scenarios';

const base: Omit<Scenario, 'id'> = {
  name: 'Baseline',
  isBaseline: true,
  color: '#4f86f7',
  lineStyle: 'solid',
  visible: true,
  isActive: true,
  sortOrder: 0,
  leverPayload: emptyLeverPayload(),
  createdAt: '2026-05-24T12:00:00Z',
  updatedAt: '2026-05-24T12:00:00Z',
};

describe('ScenarioSchema', () => {
  it('accepts a baseline scenario with empty levers', () => {
    expect(() => ScenarioSchema.omit({ id: true }).parse(base)).not.toThrow();
  });

  it('accepts a user scenario with populated levers', () => {
    const userScenario: Omit<Scenario, 'id'> = {
      ...base,
      name: 'Pay-off auto loan',
      isBaseline: false,
      isActive: false,
      color: '#a8c0fb',
      lineStyle: 'dashed',
      sortOrder: 1,
      leverPayload: {
        ...emptyLeverPayload(),
        extraLoanPayments: [{ loanId: 1, extraMonthly: 300 }],
      },
    };
    expect(() => ScenarioSchema.omit({ id: true }).parse(userScenario)).not.toThrow();
  });

  it('rejects an invalid line_style', () => {
    const bad = { ...base, lineStyle: 'dotted' as 'solid' };
    expect(() => ScenarioSchema.omit({ id: true }).parse(bad)).toThrow();
  });

  it('rejects a malformed hex color', () => {
    const bad = { ...base, color: 'reddish' };
    expect(() => ScenarioSchema.omit({ id: true }).parse(bad)).toThrow();
  });

  it('rejects a malformed leverPayload (delegated to LeverPayloadSchema)', () => {
    const bad = { ...base, leverPayload: { ...emptyLeverPayload(), lumpSums: [{ when: '2030-06-01', amount: 25000, destination: 'crypto' }] } };
    expect(() => ScenarioSchema.omit({ id: true }).parse(bad)).toThrow();
  });
});
