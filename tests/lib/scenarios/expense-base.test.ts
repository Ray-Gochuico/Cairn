import { describe, it, expect } from 'vitest';
import { emptyLeverPayload, type LeverPayload } from '@/lib/scenarios';
import { resolveExpenseBase } from '@/lib/scenarios/expense-base';

// C2: the ONE resolution of a scenario's expense base — the engine's expense seam
// (engine.ts), whose per-month stamp the What-If FI gate and the G11 row read.
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

// C2 review: the per-month AUTHORED expense (base + the periods the engine applies
// that month, obligations excluded) is now the engine's own stamp,
// MonthlyState.authoredExpenses — its pins moved to engine-authored-expenses.test.ts
// (the page no longer resolves a month-0 figure of its own).
