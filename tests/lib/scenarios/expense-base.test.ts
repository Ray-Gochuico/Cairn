import { describe, it, expect } from 'vitest';
import { emptyLeverPayload, type LeverPayload } from '@/lib/scenarios';
import { resolveExpenseBase, authoredMonthlyExpense } from '@/lib/scenarios/expense-base';

// C2: the ONE resolution of a scenario's expense base, shared by the engine
// (engine.ts, the expense seam), the What-If FI gate and the G11 register row.
const BASIS = { latestMonth: 2_500, rolling12m: 3_000, rolling12mMonths: 3 };

describe('resolveExpenseBase — engine.ts:611-617 extracted verbatim', () => {
  it('custom → customMonthly verbatim; data modes → the captured basis; a missing basis reads 0', () => {
    const custom = { ...emptyLeverPayload(), expenseSource: 'custom' as const, customMonthly: 4_000 };
    expect(resolveExpenseBase(custom, BASIS)).toBe(4_000);
    expect(resolveExpenseBase({ ...custom, customMonthly: 0 }, BASIS)).toBe(0);
    expect(resolveExpenseBase({ ...emptyLeverPayload(), expenseSource: 'rolling12m' }, BASIS)).toBe(3_000);
    expect(resolveExpenseBase({ ...emptyLeverPayload(), expenseSource: 'latestMonth' }, BASIS)).toBe(2_500);
    expect(resolveExpenseBase({ ...emptyLeverPayload(), expenseSource: 'rolling12m' }, undefined)).toBe(0);
    expect(resolveExpenseBase({ ...emptyLeverPayload(), expenseSource: 'latestMonth' }, undefined)).toBe(0);
  });

  it('a payload WITHOUT the Feature-B keys (hand-built, pre-Feature-B) resolves custom/0 — the back-compat floor', () => {
    const legacy = { ...emptyLeverPayload() } as Partial<LeverPayload>;
    delete legacy.expenseSource;
    delete legacy.customMonthly;
    expect(resolveExpenseBase(legacy as LeverPayload, BASIS)).toBe(0);
  });
});

describe('authoredMonthlyExpense — base + the periods active in ONE month, obligations excluded', () => {
  const period = { start: '2026-07-01', monthlyDelta: 1_200, durationMonths: 12 };

  it('adds only the periods active in the given month', () => {
    const p = { ...emptyLeverPayload(), expenseSource: 'custom' as const, customMonthly: 2_000, expensePeriods: [period] };
    expect(authoredMonthlyExpense(p, BASIS, '2026-07')).toBe(3_200);
    expect(authoredMonthlyExpense(p, BASIS, '2027-07')).toBe(2_000); // the 12-month period has ended
    expect(authoredMonthlyExpense(p, BASIS, '2026-06')).toBe(2_000); // not started
  });

  it('a pre-Feature-B periods-only scenario (custom/0 + periods) is AUTHORED spending, never $0 (B5)', () => {
    const p = { ...emptyLeverPayload(), expenseSource: 'custom' as const, customMonthly: 0, expensePeriods: [period] };
    expect(authoredMonthlyExpense(p, undefined, '2026-07')).toBe(1_200);
  });

  it('the hazard shape: custom/0 and no periods is $0 whatever the household owes in rent (rent is not authored here)', () => {
    const p = { ...emptyLeverPayload(), expenseSource: 'custom' as const, customMonthly: 0 };
    expect(authoredMonthlyExpense(p, BASIS, '2026-07')).toBe(0);
    // a data mode with nothing captured is $0 too — the popover's guard, not a number, speaks for it
    expect(authoredMonthlyExpense({ ...emptyLeverPayload(), expenseSource: 'rolling12m' }, { latestMonth: 0, rolling12m: 0, rolling12mMonths: 0 }, '2026-07')).toBe(0);
  });
});
