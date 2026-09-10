import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectBasisDiscipline } from '../helpers/basis-discipline';
import { GoalProgressCard, GOALS_BASIS_FIGURES, type GoalProjection } from '@/pages/Goals';
import { computeGoalProgress } from '@/lib/goal-progress';
import { __resetDollarBasisForTests } from '@/lib/calculators/dollar-basis';
import { GoalType } from '@/types/enums';
import type { Goal } from '@/types/schema';

// 2026-05-14 → 2031-01-01 = 56 months ; r = 0.06/12 ; PV 10,000 ; PMT 500.
//   projected = 10,000·1.005^56 + 500·(1.005^56 − 1)/0.005 = 45,442.77 → $45,443
//     (real anti-pin ÷1.03^(56/12) = $39,587)
//   monthlyNeeded = (50,000 − 10,000·1.005^56)·0.005/(1.005^56 − 1) = 570.72 → $571
const TODAY = new Date('2026-05-14T12:00:00Z');
const goal: Goal = {
  id: 1, householdId: 1, forPersonId: null, name: 'Sensitive Goal', type: GoalType.GENERIC,
  targetAmount: 50_000, targetDate: '2031-01-01', linkedAccountIds: [],
} as Goal;
const projection: GoalProjection = {
  ...computeGoalProgress({
    targetAmount: 50_000, targetDate: '2031-01-01', currentSaved: 10_000,
    recentMonthlyContribution: 500, annualGrowthRate: 0.06, today: TODAY,
  }),
  goal,
  recentMonthlyContribution: 500,
};
const card = () => (
  <GoalProgressCard projection={projection} accountInfoById={new Map()} onUpdateBalance={() => {}} onEdit={() => {}} />
);

describe('W5.1 Goals — projected figures are PINNED future dollars (F8)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  it('ANCHOR: $45,443 projected / $571 monthly needed, each phrased "in future dollars"; the deflated $39,587 never renders', () => {
    const { container } = render(card());
    expect(screen.getByTestId('goal-projected').textContent).toBe('$45,443');
    expect(screen.getByTestId('goal-projected').parentElement!.textContent).toContain('56 mo to target · in future dollars');
    expect(screen.getByTestId('goal-monthly-needed').textContent).toBe('$571');
    expect(screen.getByTestId('goal-monthly-needed').parentElement!.textContent)
      .toContain('at the household growth scenario, in future dollars · vs $500 recent');
    expect(screen.getByTestId('goal-target-amount').textContent).toBe('$50,000');
    expect(screen.getByTestId('goal-current-saved').textContent).toBe('$10,000');
    expect(container.textContent).not.toContain('$39,587');
    expect(screen.getByText('Off track')).toBeInTheDocument(); // 45,443 < 50,000
  });

  it('sweep: pinned-future figures + invariant inputs; no unregistered $', () => {
    expectBasisDiscipline(card(), { figures: GOALS_BASIS_FIGURES, charts: [] });
  });
});
