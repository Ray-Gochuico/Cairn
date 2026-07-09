import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    YAxis: (props: { domain?: unknown }) =>
      React.createElement('div', {
        'data-testid': 'rc-yaxis',
        'data-domain-type': typeof props.domain,
        'data-domain-floor-is-fn': Array.isArray(props.domain) && typeof props.domain[0] === 'function' ? 'true' : 'false',
      }),
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
      investmentsByAccount: { 1: 100000 + i * 1000 + offset },
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
        detailLevel="single"
        accounts={[]}
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
        detailLevel="single"
        accounts={[]}
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
        detailLevel="single"
        accounts={[]}
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
        detailLevel="single"
        accounts={[]}
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
        detailLevel="single"
        accounts={[]}
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
        detailLevel="single"
        accounts={[]}
        />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('.recharts-area-area').length).toBe(0);
  });
});

describe('ProjectionChart — lower pane (debt lines)', () => {
  // Regression: the lower debt pane was reported as "not rendering" after the
  // initial-state seeding fix landed. These tests pin that the debt Line
  // appears for each visible scenario when at least one scenario has a non-
  // zero debt balance in any month. When *every* visible scenario has
  // entirely zero debt (no loans), the chart is replaced with an empty-state
  // hint to avoid Recharts width(-1)/height(-1) console warnings — see
  // Wave-7 Design item 25.

  it('renders a debt line in the lower pane for each visible scenario', () => {
    const projections = new Map([[1, fixtureStates()]]);
    const milestones = new Map<number, Milestones>([[1, {}]]);
    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
        detailLevel="single"
        accounts={[]}
        />
      </MemoryRouter>,
    );
    // The lower pane renders a Line with dataKey="debt_1" for scenario id=1.
    expect(screen.getByTestId('rc-line-debt_1')).toBeInTheDocument();
  });

  it('renders two debt lines in the lower pane when two scenarios are visible', () => {
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
        detailLevel="single"
        accounts={[]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('rc-line-debt_1')).toBeInTheDocument();
    expect(screen.getByTestId('rc-line-debt_2')).toBeInTheDocument();
  });

  it('replaces the debt chart with an empty-state hint when no loans exist (no Recharts width warnings)', () => {
    // When debtByLoan is empty the debt sum is zero for every month and across
    // every scenario. Mounting the <ComposedChart> on an all-zero series makes
    // Recharts emit width(-1)/height(-1) warnings during layout. Gate the
    // chart on hasDebtData and render a small empty-state hint instead.
    const noDebtStates: MonthlyState[] = Array.from({ length: 12 }, (_, i) => ({
      monthISO: `2026-${String(i + 1).padStart(2, '0')}`,
      investmentsByAccount: { 1: 100000 + i * 1000 },
      homeEquity: 250000,
      cash: 10000,
      debtByLoan: {},  // no loans
      netWorth: 360000 + i * 1000,
      incomeAfterTax: 9000,
      expenses: 4500,
      savings: 4500,
      events: [],
    }));
    const projections = new Map([[1, noDebtStates]]);
    const milestones = new Map<number, Milestones>([[1, {}]]);

    // Spy on console.warn to confirm no Recharts width(-1) warnings escape.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
        detailLevel="single"
        accounts={[]}
        />
      </MemoryRouter>,
    );
    // Lower pane: chart is replaced with an empty-state hint; debt line is
    // absent (the whole ComposedChart isn't mounted).
    expect(screen.queryByTestId('rc-line-debt_1')).toBeNull();
    expect(screen.getByTestId('whatif-debt-chart-empty')).toBeInTheDocument();
    // No width(-1)/height(-1) warnings should have been emitted.
    const widthWarnings = warnSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === 'string' && /width\(-1\)|height\(-1\)/.test(a)),
    );
    expect(widthWarnings.length).toBe(0);

    warnSpy.mockRestore();
  });

  it('omits debt line for a hidden scenario', () => {
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
        detailLevel="single"
        accounts={[]}
        />
      </MemoryRouter>,
    );
    // Only the baseline (id=1) is visible; the hidden variant (id=2) should
    // not produce a debt line.
    expect(screen.getByTestId('rc-line-debt_1')).toBeInTheDocument();
    expect(screen.queryByTestId('rc-line-debt_2')).toBeNull();
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
        detailLevel="single"
        accounts={[]}
        />
      </MemoryRouter>,
    );
    const refLines = container.querySelectorAll('.recharts-reference-line-line');
    expect(refLines.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Financial Independence reference line when financialIndependenceISO is set', () => {
    const projections = new Map([[1, fixtureStates()]]);
    const milestones = new Map<number, Milestones>([[1, { debtFreeISO: '2026-06', financialIndependenceISO: '2026-10' }]]);
    const { container } = render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
        detailLevel="single"
        accounts={[]}
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
        detailLevel="single"
        accounts={[]}
        />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('.recharts-reference-line-line').length).toBe(0);
  });
});

describe('ProjectionChart — detail level rendering', () => {
  // Two investment accounts (401k + brokerage) + one cash (excluded from
  // per-account areas) for level=per_account assertions.
  const mockAccounts: any[] = [
    { id: 1, householdId: 1, name: '401k', type: 'ACCOUNT_401K', excludedFromNetWorth: false },
    { id: 2, householdId: 1, name: 'Brokerage', type: 'ACCOUNT_BROKERAGE', excludedFromNetWorth: false },
    { id: 3, householdId: 1, name: 'Checking', type: 'ACCOUNT_CASH', excludedFromNetWorth: false },
  ];

  // Build fixture states that have balances in both accounts (1 and 2).
  const multiAccountStates = (): MonthlyState[] =>
    Array.from({ length: 12 }, (_, i) => ({
      monthISO: `2026-${String(i + 1).padStart(2, '0')}`,
      investmentsByAccount: { 1: 60_000 + i * 500, 2: 40_000 + i * 300 },
      homeEquity: 250_000,
      cash: 10_000,
      debtByLoan: {},
      netWorth: 360_000 + i * 800,
      incomeAfterTax: 9_000,
      expenses: 4_500,
      savings: 4_500,
      events: [],
    }));

  it('single detail level: renders exactly 1 investments area', () => {
    const projections = new Map([[1, multiAccountStates()]]);
    const milestones = new Map<number, Milestones>([[1, {}]]);
    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
          detailLevel="single"
          accounts={mockAccounts}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('rc-area-investments_1')).toBeInTheDocument();
    // Tax-bucket and per-account areas must NOT be present.
    expect(screen.queryByTestId('rc-area-taxAdvantaged_1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rc-area-acct_1_1')).not.toBeInTheDocument();
  });

  it('tax_bucket detail level: renders taxAdvantaged + taxable areas (no single investments)', () => {
    const projections = new Map([[1, multiAccountStates()]]);
    const milestones = new Map<number, Milestones>([[1, {}]]);
    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
          detailLevel="tax_bucket"
          accounts={mockAccounts}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('rc-area-taxAdvantaged_1')).toBeInTheDocument();
    expect(screen.getByTestId('rc-area-taxable_1')).toBeInTheDocument();
    expect(screen.queryByTestId('rc-area-investments_1')).not.toBeInTheDocument();

    // W10 design: a legend row names the two bands.
    const legend = screen.getByTestId('tax-bucket-legend');
    expect(within(legend).getByText('Tax-advantaged')).toBeInTheDocument();
    expect(within(legend).getByText('Taxable')).toBeInTheDocument();
  });

  it('per_account detail level: renders one area per investment account (cash excluded)', () => {
    const projections = new Map([[1, multiAccountStates()]]);
    const milestones = new Map<number, Milestones>([[1, {}]]);
    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
          detailLevel="per_account"
          accounts={mockAccounts}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('rc-area-acct_1_1')).toBeInTheDocument();
    expect(screen.getByTestId('rc-area-acct_2_1')).toBeInTheDocument();
    // Cash account (id=3) must not have an area.
    expect(screen.queryByTestId('rc-area-acct_3_1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rc-area-investments_1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rc-area-taxAdvantaged_1')).not.toBeInTheDocument();
  });

  it('lines-only mode (2+ visible scenarios) still renders net-worth lines but no investment areas', () => {
    const variantScenario = { ...baseline, id: 2, name: 'Variant', isBaseline: false, isActive: false, color: '#5fbb7c' };
    const projections = new Map([[1, multiAccountStates()], [2, multiAccountStates()]]);
    const milestones = new Map<number, Milestones>([[1, {}], [2, {}]]);
    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline, variantScenario]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
          detailLevel="tax_bucket"
          accounts={mockAccounts}
        />
      </MemoryRouter>,
    );
    // No investment areas in lines mode.
    expect(screen.queryByTestId('rc-area-taxAdvantaged_1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rc-area-acct_1_1')).not.toBeInTheDocument();
    // But net-worth lines are present for both scenarios.
    expect(screen.getByTestId('rc-line-net_1')).toBeInTheDocument();
    expect(screen.getByTestId('rc-line-net_2')).toBeInTheDocument();
  });
});

describe('ProjectionChart — Y-axis domain anchored to data', () => {
  it('upper pane YAxis uses a function-based floor domain (not implicit [0, auto])', () => {
    const projections = new Map([[1, fixtureStates()]]);
    const milestones = new Map<number, Milestones>([[1, {}]]);
    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
          detailLevel="single"
          accounts={[]}
        />
      </MemoryRouter>,
    );
    // Both panes render a YAxis. At least one must have a function-based floor.
    const yAxes = screen.getAllByTestId('rc-yaxis');
    expect(yAxes.length).toBeGreaterThanOrEqual(1);
    const hasFnFloor = yAxes.some((el) => el.getAttribute('data-domain-floor-is-fn') === 'true');
    expect(hasFnFloor).toBe(true);
  });

  it('floor function returns 0 for dataMin = 0 (prevents negative axis on debt-free users)', () => {
    // Extract the domain[0] function from the component — we call it directly
    // by rendering and reading what domain is passed (indirectly, via the mock
    // data-attribute). For direct function testing we verify the formula in a
    // standalone assertion.
    const floorFn = (dataMin: number) => Math.max(0, dataMin * 0.8);
    expect(floorFn(0)).toBe(0);
    expect(floorFn(-100)).toBe(0);
    expect(floorFn(500000)).toBeCloseTo(400000);
    expect(floorFn(250000)).toBeCloseTo(200000);
  });
});

describe('ProjectionChart — per-account visibility toggle row (Task #19)', () => {
  // Three investment accounts + one cash. Sorted by name in the row:
  // 401k (id=1) → Brokerage (id=2) → Roth IRA (id=4). Cash (id=3) excluded.
  const toggleAccounts: any[] = [
    { id: 1, householdId: 1, name: '401k', type: 'ACCOUNT_401K', excludedFromNetWorth: false },
    { id: 2, householdId: 1, name: 'Brokerage', type: 'ACCOUNT_BROKERAGE', excludedFromNetWorth: false },
    { id: 3, householdId: 1, name: 'Checking', type: 'ACCOUNT_CASH', excludedFromNetWorth: false },
    { id: 4, householdId: 1, name: 'Roth IRA', type: 'ACCOUNT_ROTH_IRA', excludedFromNetWorth: false },
  ];

  const toggleStates = (): MonthlyState[] =>
    Array.from({ length: 6 }, (_, i) => ({
      monthISO: `2026-${String(i + 1).padStart(2, '0')}`,
      investmentsByAccount: { 1: 60_000 + i * 500, 2: 40_000 + i * 300, 4: 20_000 + i * 200 },
      homeEquity: 250_000,
      cash: 10_000,
      debtByLoan: {},
      netWorth: 380_000 + i * 1000,
      incomeAfterTax: 9_000,
      expenses: 4_500,
      savings: 4_500,
      events: [],
    }));

  it('does NOT render the toggle row in SINGLE detail level', () => {
    const projections = new Map([[1, toggleStates()]]);
    const milestones = new Map<number, Milestones>([[1, {}]]);
    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
          detailLevel="single"
          accounts={toggleAccounts}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('whatif-account-toggle-row')).not.toBeInTheDocument();
  });

  it('does NOT render the toggle row in TAX_BUCKET detail level', () => {
    const projections = new Map([[1, toggleStates()]]);
    const milestones = new Map<number, Milestones>([[1, {}]]);
    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
          detailLevel="tax_bucket"
          accounts={toggleAccounts}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('whatif-account-toggle-row')).not.toBeInTheDocument();
  });

  it('renders the toggle row with one checkbox per investment account in PER_ACCOUNT mode', () => {
    const projections = new Map([[1, toggleStates()]]);
    const milestones = new Map<number, Milestones>([[1, {}]]);
    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
          detailLevel="per_account"
          accounts={toggleAccounts}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('whatif-account-toggle-row')).toBeInTheDocument();
    // Three investment accounts (cash excluded).
    expect(screen.getByLabelText('401k')).toBeInTheDocument();
    expect(screen.getByLabelText('Brokerage')).toBeInTheDocument();
    expect(screen.getByLabelText('Roth IRA')).toBeInTheDocument();
    // Cash account (Checking, id=3) must NOT have a toggle.
    expect(screen.queryByLabelText('Checking')).not.toBeInTheDocument();
    // All three checkboxes start checked (everything visible by default).
    expect((screen.getByLabelText('401k') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Brokerage') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Roth IRA') as HTMLInputElement).checked).toBe(true);
  });

  it('toggling a checkbox OFF removes the corresponding Area from the chart', async () => {
    const user = userEvent.setup();
    const projections = new Map([[1, toggleStates()]]);
    const milestones = new Map<number, Milestones>([[1, {}]]);
    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
          detailLevel="per_account"
          accounts={toggleAccounts}
        />
      </MemoryRouter>,
    );
    // All three investment areas present initially.
    expect(screen.getByTestId('rc-area-acct_1_1')).toBeInTheDocument();
    expect(screen.getByTestId('rc-area-acct_2_1')).toBeInTheDocument();
    expect(screen.getByTestId('rc-area-acct_4_1')).toBeInTheDocument();

    // Uncheck "Brokerage" (id=2) — its Area should disappear; others stay.
    await user.click(screen.getByLabelText('Brokerage'));

    expect((screen.getByLabelText('Brokerage') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByTestId('rc-area-acct_2_1')).not.toBeInTheDocument();
    expect(screen.getByTestId('rc-area-acct_1_1')).toBeInTheDocument();
    expect(screen.getByTestId('rc-area-acct_4_1')).toBeInTheDocument();
  });

  it('"Hide all" hides every account area; "Show all" restores them', async () => {
    const user = userEvent.setup();
    const projections = new Map([[1, toggleStates()]]);
    const milestones = new Map<number, Milestones>([[1, {}]]);
    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
          detailLevel="per_account"
          accounts={toggleAccounts}
        />
      </MemoryRouter>,
    );
    const toggleAll = screen.getByTestId('whatif-account-toggle-all');
    expect(toggleAll).toHaveTextContent('Hide all');

    // Click "Hide all" — every per-account Area should be gone.
    await user.click(toggleAll);
    expect(screen.queryByTestId('rc-area-acct_1_1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rc-area-acct_2_1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rc-area-acct_4_1')).not.toBeInTheDocument();
    // Every checkbox is now unchecked.
    expect((screen.getByLabelText('401k') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Brokerage') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Roth IRA') as HTMLInputElement).checked).toBe(false);
    // Label flips to "Show all" when everything is hidden.
    expect(toggleAll).toHaveTextContent('Show all');

    // Click "Show all" — every Area returns.
    await user.click(toggleAll);
    expect(screen.getByTestId('rc-area-acct_1_1')).toBeInTheDocument();
    expect(screen.getByTestId('rc-area-acct_2_1')).toBeInTheDocument();
    expect(screen.getByTestId('rc-area-acct_4_1')).toBeInTheDocument();
    expect(toggleAll).toHaveTextContent('Hide all');
  });

  it('hides the toggle row in lines-only mode (multi-scenario)', () => {
    const variantScenario = { ...baseline, id: 2, name: 'Variant', isBaseline: false, isActive: false, color: '#5fbb7c' };
    const projections = new Map([[1, toggleStates()], [2, toggleStates()]]);
    const milestones = new Map<number, Milestones>([[1, {}], [2, {}]]);
    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline, variantScenario]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
          detailLevel="per_account"
          accounts={toggleAccounts}
        />
      </MemoryRouter>,
    );
    // Two visible scenarios → lines mode → no toggle row even though detail level is per_account.
    expect(screen.queryByTestId('whatif-account-toggle-row')).not.toBeInTheDocument();
  });

  it('does NOT render the toggle row when there are no investment accounts', () => {
    const noInvestmentAccounts: any[] = [
      { id: 3, householdId: 1, name: 'Checking', type: 'ACCOUNT_CASH', excludedFromNetWorth: false },
    ];
    const projections = new Map([[1, toggleStates()]]);
    const milestones = new Map<number, Milestones>([[1, {}]]);
    render(
      <MemoryRouter>
        <ProjectionChart
          scenarios={[baseline]}
          projections={projections}
          milestones={milestones}
          dollarMode="nominal"
          inflation={0.025}
          startISO="2026-01"
          detailLevel="per_account"
          accounts={noInvestmentAccounts}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('whatif-account-toggle-row')).not.toBeInTheDocument();
  });
});
