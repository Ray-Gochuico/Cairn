import { describe, expect, it } from 'vitest';
import { CALCULATOR_CARDS } from '@/pages/calculators/calculator-registry';
import { CALCULATOR_CARD_IDS } from '@/lib/calculator-card-layout';

describe('calculator registry (Wave 17 lock-step — the comments became assertions)', () => {
  it('registers every canonical id, in canonical order, each with a Component', () => {
    expect(CALCULATOR_CARDS.map((c) => c.id)).toEqual([...CALCULATOR_CARD_IDS]);
    for (const card of CALCULATOR_CARDS) {
      expect(card.Component, `missing Component for ${card.id}`).toBeTypeOf('function');
    }
  });
  it('overtime is the only gated card and carries its reason', () => {
    const gated = CALCULATOR_CARDS.filter((c) => c.isAvailable);
    expect(gated.map((c) => c.id)).toEqual(['overtime']);
    expect(gated[0].unavailableReason).toMatch(/hourly or salary\+OT person/i);
  });
  it('overtime availability matches the HOURLY / SALARY_WITH_OT rule', () => {
    const overtime = CALCULATOR_CARDS.find((c) => c.id === 'overtime')!;
    const person = (employmentType: string) => ({ employmentType }) as never;
    expect(overtime.isAvailable!({ persons: [person('HOURLY')] })).toBe(true);
    expect(overtime.isAvailable!({ persons: [person('SALARY_WITH_OT')] })).toBe(true);
    expect(overtime.isAvailable!({ persons: [person('SALARY_NO_OT')] })).toBe(false);
    expect(overtime.isAvailable!({ persons: [] })).toBe(false);
  });
});
