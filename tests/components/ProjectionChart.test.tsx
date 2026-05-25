import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProjectionChart from '@/components/whatif/ProjectionChart';
import type { Scenario } from '@/types/scenario';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { MonthlyState, Milestones } from '@/lib/scenarios';

const baseline: Scenario = {
  id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid',
  visible: true, isActive: true, sortOrder: 0, leverPayload: emptyLeverPayload(),
  createdAt: 't', updatedAt: 't',
};
const variant: Scenario = {
  id: 2, name: 'Aggressive', isBaseline: false, color: '#ef8b5a', lineStyle: 'solid',
  visible: true, isActive: false, sortOrder: 1, leverPayload: emptyLeverPayload(),
  createdAt: 't', updatedAt: 't',
};

const fixtureStates = (offset = 0): MonthlyState[] => {
  const out: MonthlyState[] = [];
  for (let i = 0; i < 12; i++) {
    const month = `2026-${String((i % 12) + 1).padStart(2, '0')}`;
    out.push({
      monthISO: month,
      investments: 100000 + i * 1000 + offset,
      homeEquity: 250000,
      cash: 10000,
      debtByLoan: { 1: Math.max(0, 18000 - i * 500) },
      netWorth: 100000 + i * 1000 + 250000 + 10000 - Math.max(0, 18000 - i * 500) + offset,
      incomeAfterTax: 9000,
      expenses: 4500,
      savings: 4500,
      events: [],
    });
  }
  return out;
};

describe('ProjectionChart — lines-only mode (2+ scenarios visible)', () => {
  it('renders without crashing when two scenarios are visible', () => {
    const projections = new Map([[1, fixtureStates()], [2, fixtureStates(5000)]]);
    const milestones = new Map<number, Milestones>([[1, {}], [2, {}]]);
    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline, variant]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('whatif-projection-chart')).toBeInTheDocument();
    expect(screen.getByTestId('whatif-chart-mode')).toHaveTextContent('lines');
  });

  it('omits the composition stacked area in lines mode', () => {
    const projections = new Map([[1, fixtureStates()], [2, fixtureStates(5000)]]);
    const milestones = new Map<number, Milestones>([[1, {}], [2, {}]]);
    const { container } = render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline, variant]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
        />
      </MemoryRouter>,
    );
    const areas = container.querySelectorAll('.recharts-area-area');
    expect(areas.length).toBe(0);
  });

  it('omits scenarios with visible=false', () => {
    const projections = new Map([[1, fixtureStates()], [2, fixtureStates(5000)]]);
    const milestones = new Map<number, Milestones>([[1, {}], [2, {}]]);
    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline, { ...variant, visible: false }]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('whatif-chart-mode')).toHaveTextContent('composition');
  });
});
