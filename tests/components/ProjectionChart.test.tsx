import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Scenario } from '@/types/scenario';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { MonthlyState, Milestones } from '@/lib/scenarios';

// Recharts' ResponsiveContainer measures its 0x0 parent in jsdom and emits no
// concrete SVG — we mock the small set of primitives used in ProjectionChart
// so we can assert which branches rendered. Element tags appear in the DOM
// with data-testid attributes mirroring their recharts class hook.
vi.mock('recharts', () => {
  const passthrough = (testId: string) => ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': testId }, children);

  return {
    ResponsiveContainer: passthrough('rc-responsive'),
    ComposedChart: passthrough('rc-composed'),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Area: (props: { dataKey: string }) =>
      React.createElement('div', {
        className: 'recharts-area-area',
        'data-key': props.dataKey,
        'data-testid': `rc-area-${props.dataKey}`,
      }),
    Line: (props: { dataKey: string }) =>
      React.createElement('div', {
        className: 'recharts-line-curve',
        'data-key': props.dataKey,
        'data-testid': `rc-line-${props.dataKey}`,
      }),
    ReferenceLine: (props: { x?: string }) =>
      React.createElement('div', {
        className: 'recharts-reference-line-line',
        'data-x': props.x,
      }),
  };
});

// Import AFTER mocking recharts.
import ProjectionChart from '@/components/whatif/ProjectionChart';

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
    expect(container.querySelectorAll('.recharts-area-area').length).toBe(0);
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

describe('ProjectionChart — composition mode (exactly 1 scenario visible)', () => {
  it('renders stacked areas for investments / home equity / cash plus the net-worth line', () => {
    const projections = new Map([[1, fixtureStates()]]);
    const milestones = new Map<number, Milestones>([[1, {}]]);
    const { container } = render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('whatif-chart-mode')).toHaveTextContent('composition');
    expect(container.querySelectorAll('.recharts-area-area').length).toBe(3);
  });

  it('composition collapses when a second scenario becomes visible', () => {
    const projections = new Map([[1, fixtureStates()], [2, fixtureStates(5000)]]);
    const milestones = new Map<number, Milestones>([[1, {}], [2, {}]]);
    const { rerender, container } = render(
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
    expect(container.querySelectorAll('.recharts-area-area').length).toBe(3);
    rerender(
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
    expect(container.querySelectorAll('.recharts-area-area').length).toBe(0);
  });
});

describe('ProjectionChart — milestone reference lines', () => {
  it('renders a Debt-free reference line at the milestone month', () => {
    const projections = new Map([[1, fixtureStates()]]);
    const milestones = new Map<number, Milestones>([[1, { debtFreeISO: '2026-06' }]]);
    const { container } = render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
        />
      </MemoryRouter>,
    );
    const refLines = container.querySelectorAll('.recharts-reference-line-line');
    expect(refLines.length).toBeGreaterThanOrEqual(1);
  });

  it('renders FIRE reference line when fireISO is set', () => {
    const projections = new Map([[1, fixtureStates()]]);
    const milestones = new Map<number, Milestones>([[1, { debtFreeISO: '2026-06', fireISO: '2026-10' }]]);
    const { container } = render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
        />
      </MemoryRouter>,
    );
    const refLines = container.querySelectorAll('.recharts-reference-line-line');
    expect(refLines.length).toBeGreaterThanOrEqual(2);
  });

  it('omits reference lines for scenarios that never reach the milestone', () => {
    const projections = new Map([[1, fixtureStates()]]);
    const milestones = new Map<number, Milestones>([[1, {}]]);
    const { container } = render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
        />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('.recharts-reference-line-line').length).toBe(0);
  });
});
