import { describe, it, expect } from 'vitest';
import { typicalMonthlyContribution } from '@/lib/typical-contribution';

const TODAY = '2026-05-14';

describe('typicalMonthlyContribution (Wave 18 D4)', () => {
  it('rolling-12-month sum ÷ 12, rounded to the dollar (matches the FI window)', () => {
    // 12 × $500 across the last year → $6,000 ÷ 12 = $500.
    const contributions = [
      '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01', '2025-10-01',
      '2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01',
      '2026-04-01', '2026-05-01',
    ].map((date) => ({ date, amount: 500 }));
    expect(typicalMonthlyContribution(contributions, TODAY)).toBe(500);
  });

  it('rounds to the dollar', () => {
    expect(
      typicalMonthlyContribution([{ date: '2026-01-01', amount: 1000 }], TODAY),
    ).toBe(83); // 1000 / 12 = 83.33 → 83
  });

  it('returns null (blank field) when there is no history — never a fabricated demo number', () => {
    expect(typicalMonthlyContribution([], TODAY)).toBeNull();
  });

  it('excludes rows outside the window: older than a year and future-dated', () => {
    const contributions = [
      { date: '2024-01-01', amount: 99_999 }, // > 1y old
      { date: '2026-06-01', amount: 99_999 }, // future
      { date: '2026-04-01', amount: 1_200 },
    ];
    expect(typicalMonthlyContribution(contributions, TODAY)).toBe(100);
  });

  it('a window edge exactly one year ago is included', () => {
    expect(
      typicalMonthlyContribution([{ date: '2025-05-14', amount: 2_400 }], TODAY),
    ).toBe(200);
  });
});
