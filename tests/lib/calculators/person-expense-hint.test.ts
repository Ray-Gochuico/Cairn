import { describe, it, expect } from 'vitest';
import { personMonthlyExpenseHint } from '@/lib/calculators/person-expense-hint';

const t = (date: string, amount: number, personId: number | null) => ({ date, amount, personId });

describe('personMonthlyExpenseHint', () => {
  const today = '2026-07-30';
  it('averages the last 90 days of attributed purchases over 3 months', () => {
    const rows = [
      t('2026-07-10', 900, 2), t('2026-06-10', 900, 2), t('2026-05-10', 900, 2),
      t('2026-07-11', 500, 1),      // other person — excluded
      t('2026-07-12', 400, null),   // unattributed — excluded (D-B4)
      t('2025-01-01', 5000, 2),     // out of window
    ];
    expect(personMonthlyExpenseHint(rows, 2, today)).toBe(900);
  });
  it('nets refunds and returns null with no attributed activity or a non-positive net', () => {
    expect(personMonthlyExpenseHint([], 2, today)).toBeNull();
    expect(personMonthlyExpenseHint([t('2026-07-10', -50, 2)], 2, today)).toBeNull();
  });
});
