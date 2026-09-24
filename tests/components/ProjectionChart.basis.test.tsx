import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expectBasisDiscipline } from '../helpers/basis-discipline';
import { collectSourceFiles } from '../policy/source-walker';
import { useWhatIfBasisView } from '@/lib/calculators/basis-view';
import { WHATIF_PAGE_ID, __resetDollarBasisForTests, useDollarBasisStore } from '@/lib/calculators/dollar-basis';
import { formatCurrency } from '@/lib/format';
import type { Milestones, MonthlyState } from '@/lib/scenarios';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';

// W-I house recharts mock: the mocked ComposedChart exposes the plotted rows as
// `data-rows` — BOTH the spec-m4 wiring probe (the sweep cannot see plotted
// values) and the sweep's own rowsTestId hook read that one element.
vi.mock('recharts', () => {
  const passthrough = (testId: string) => ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': testId }, children);
  return {
    ResponsiveContainer: passthrough('rc-responsive'),
    ComposedChart: ({ data, children }: { data?: unknown[]; children?: React.ReactNode }) =>
      React.createElement(
        'div',
        { 'data-testid': 'rc-composed-chart', 'data-rows': JSON.stringify(data ?? []) },
        children,
      ),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Area: () => null,
    Line: () => null,
    ReferenceLine: () => null,
  };
});
import ProjectionChart, { WHATIF_BASIS_CHARTS } from '@/components/whatif/ProjectionChart';

const ROOT = path.resolve(__dirname, '..', '..');

const baseline: Scenario = {
  id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid',
  visible: true, isActive: true, sortOrder: 0, leverPayload: emptyLeverPayload(), createdAt: 't', updatedAt: 't',
};
// The sibling file's fixture (12 months from 2026-01): netWorth(i) = 100000+i·1000+250000+10000−max(0,18000−i·500).
const fixtureStates = (): MonthlyState[] =>
  Array.from({ length: 12 }, (_, i) => ({
    monthISO: `2026-${String(i + 1).padStart(2, '0')}`,
    investmentsByAccount: { 1: 100000 + i * 1000 },
    homeEquity: 250000, cash: 10000, debtByLoan: { 1: Math.max(0, 18000 - i * 500) },
    netWorth: 100000 + i * 1000 + 250000 + 10000 - Math.max(0, 18000 - i * 500),
    incomeAfterTax: 9000, expenses: 4500, savings: 4500, events: [],
  }));
const PROJECTIONS = new Map([[1, fixtureStates()]]);
const MILESTONES = new Map<number, Milestones>([[1, {}]]);

function Harness() {
  const view = useWhatIfBasisView({ projections: PROJECTIONS, milestones: MILESTONES, inflation: 0.025, startISO: '2026-01' });
  return (
    <MemoryRouter>
      <ProjectionChart
        scenarios={[baseline]}
        displayProjections={view.displayProjections}
        basisCaption={view.chartCaption}
        milestones={MILESTONES}
        detailLevel="single"
        accounts={[]}
      />
    </MemoryRouter>
  );
}
const probeRows = () =>
  JSON.parse(screen.getAllByTestId('rc-composed-chart')[0].getAttribute('data-rows') ?? '[]') as Array<
    Record<string, number | string>
  >;

describe('W5.1 ProjectionChart — caption + wiring probe (m4 layer b) + sweep', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  it('ANCHOR PAIR: month 11 net worth $358,500 plots as $350,477 under Today (÷1.025^(11/12)) and $358,500 under Future', () => {
    render(<Harness />);
    expect(screen.getByTestId('whatif-chart-caption').textContent).toBe("All lines in today's dollars — one deflator, 2.5% inflation.");
    let last = probeRows()[11];
    expect(last.monthISO).toBe('2026-12');
    expect(formatCurrency(Number(last.net_1))).toBe('$350,477'); // 358,500 × 0.9776193524583833
    expect(formatCurrency(Number(last.net_1))).not.toBe('$358,500'); // nominal anti-pin
    expect(formatCurrency(Number(probeRows()[0].net_1))).toBe('$342,000'); // year 0 identity
    act(() => useDollarBasisStore.getState().setBasis(WHATIF_PAGE_ID, 'future'));
    expect(screen.getByTestId('whatif-chart-caption').textContent).toBe('All lines in future dollars — not adjusted for inflation.');
    last = probeRows()[11];
    expect(formatCurrency(Number(last.net_1))).toBe('$358,500');
    expect(formatCurrency(Number(last.net_1))).not.toBe('$350,477'); // real anti-pin
  });

  it('sweep: the chart is a registered convertible chart (caption AND plotted rows); no loose $ outside it', () => {
    expectBasisDiscipline(<Harness />, { figures: [], charts: WHATIF_BASIS_CHARTS }, { pageId: WHATIF_PAGE_ID });
  });

  // Review MINOR 10: by the frozen W2 contract an ABSENT rowsTestId means
  // caption-only, so a one-line registry edit would silently drop the plotted-
  // rows clause from the sweep above. Pin the registry's shape: every
  // CONVERTIBLE chart registered on /what-if declares its rows hook, and the
  // hook resolves inside the rendered chart (never a dangling id).
  it('registry sentinel: every convertible What-If chart carries a rowsTestId that resolves inside the chart', async () => {
    // Inventory: the page's chart registrations live in ONE module, so the loop
    // below really is "every chart registered on /what-if".
    const whatIfSources = [
      ...(await collectSourceFiles(path.join(ROOT, 'src/components/whatif'), ['.tsx', '.ts'])),
      path.join(ROOT, 'src/pages/WhatIf.tsx'),
    ];
    const registering = whatIfSources
      .filter((f) => /RegisteredChart\[\]/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
    expect(registering).toEqual(['src/components/whatif/ProjectionChart.tsx']);

    const convertible = WHATIF_BASIS_CHARTS.filter((c) => c.cls === 'convertible');
    expect(convertible.length).toBeGreaterThan(0);
    for (const c of convertible) expect(c.rowsTestId, `${c.chartTestId} must declare rowsTestId`).toBeTruthy();
    expect(WHATIF_BASIS_CHARTS).toEqual([
      {
        chartTestId: 'whatif-projection-chart',
        captionTestId: 'whatif-chart-caption',
        cls: 'convertible',
        rowsTestId: 'rc-composed-chart',
      },
    ]);

    render(<Harness />);
    for (const c of convertible) {
      const chart = screen.getByTestId(c.chartTestId);
      expect(chart.querySelector(`[data-testid="${c.rowsTestId}"]`)).not.toBeNull();
    }
  });
});
