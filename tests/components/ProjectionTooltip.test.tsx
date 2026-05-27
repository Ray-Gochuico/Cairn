import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DecomposedTooltipContent,
  decomposeStep,
} from '@/components/whatif/ProjectionTooltip';
import type { Scenario } from '@/types/scenario';
import type { MonthlyState } from '@/lib/scenarios';
import { emptyLeverPayload } from '@/lib/scenarios';

// Task #25 — projection chart tooltip decomposition.
//
// We test the named content function directly. Recharts tooltips render
// inside a wrapper that depends on layout measurement which jsdom can't
// provide reliably — the spec recommends asserting the content function in
// isolation with a synthetic payload, which is exactly what this file does.

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

function stateAt(monthISO: string, overrides: Partial<MonthlyState> = {}): MonthlyState {
  return {
    monthISO,
    investmentsByAccount: { 1: 100_000 },
    homeEquity: 250_000,
    cash: 10_000,
    debtByLoan: {},
    netWorth: 360_000,
    incomeAfterTax: 9_000,
    expenses: 4_500,
    savings: 4_500,
    events: [],
    compoundReturnAdded: 0,
    autoInvestedSalarySurplus: 0,
    salarySurplusToCash: 0,
    leverContributionsInvested: 0,
    lumpSumInvested: 0,
    withdrawnFromInvestments: 0,
    ...overrides,
  };
}

describe('decomposeStep', () => {
  it('returns rows in fixed order with values from MonthlyState', () => {
    const state = stateAt('2026-06', {
      compoundReturnAdded: 1_200,
      autoInvestedSalarySurplus: 4_500,
      salarySurplusToCash: 0,
      leverContributionsInvested: 0,
      lumpSumInvested: 20_000,
      withdrawnFromInvestments: 0,
    });
    const rows = decomposeStep(state);
    // Task β2 — "Surplus to cash" row sits between Auto-invested salary and
    // Lever contributions so the user reads the auto-invest opt-out path
    // right next to the auto-invest-on path it replaces.
    expect(rows.map((r) => r.label)).toEqual([
      'Compound return',
      'Auto-invested salary',
      'Surplus to cash',
      'Lever contributions',
      'Lump sums',
      'Withdrawals',
    ]);
    expect(rows[0].value).toBe(1_200);
    expect(rows[4].value).toBe(20_000);
    expect(rows[5].direction).toBe('out');
  });

  it('defaults missing fields to 0 (the seed state has no decomposition)', () => {
    const state = stateAt('2026-05', {
      compoundReturnAdded: undefined,
      autoInvestedSalarySurplus: undefined,
      salarySurplusToCash: undefined,
      leverContributionsInvested: undefined,
      lumpSumInvested: undefined,
      withdrawnFromInvestments: undefined,
    });
    const rows = decomposeStep(state);
    for (const row of rows) {
      expect(row.value).toBe(0);
    }
  });

  it('populates the Surplus to cash row from MonthlyState.salarySurplusToCash', () => {
    const state = stateAt('2026-06', {
      autoInvestedSalarySurplus: 0,
      salarySurplusToCash: 3_200,
    });
    const rows = decomposeStep(state);
    const cashRow = rows.find((r) => r.label === 'Surplus to cash');
    expect(cashRow).toBeDefined();
    expect(cashRow!.value).toBe(3_200);
    expect(cashRow!.direction).toBe('in');
  });
});

describe('DecomposedTooltipContent — basic rendering', () => {
  it('returns null when active is explicitly false', () => {
    const projections = new Map<number, MonthlyState[]>([[1, [stateAt('2026-05'), stateAt('2026-06')]]]);
    const { container } = render(
      <DecomposedTooltipContent
        label="2026-06"
        active={false}
        scenarios={[baseline]}
        displayProjections={projections}
      />,
    );
    // No nodes — the function bails before rendering any HTML.
    expect(container.firstChild).toBeNull();
  });

  it('returns null when no visible scenarios are passed', () => {
    const projections = new Map<number, MonthlyState[]>([[1, [stateAt('2026-05'), stateAt('2026-06')]]]);
    const { container } = render(
      <DecomposedTooltipContent
        label="2026-06"
        active
        scenarios={[]}
        displayProjections={projections}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the month label at the top of the tooltip', () => {
    const projections = new Map<number, MonthlyState[]>([[1, [stateAt('2026-05'), stateAt('2026-06')]]]);
    render(
      <DecomposedTooltipContent
        label="2026-06"
        active
        scenarios={[baseline]}
        displayProjections={projections}
      />,
    );
    const tooltip = screen.getByTestId('whatif-projection-tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('2026-06');
  });

  it('renders one scenario block per visible scenario', () => {
    const projections = new Map<number, MonthlyState[]>([
      [1, [stateAt('2026-05'), stateAt('2026-06')]],
      [2, [stateAt('2026-05'), stateAt('2026-06')]],
    ]);
    render(
      <DecomposedTooltipContent
        label="2026-06"
        active
        scenarios={[baseline, variant]}
        displayProjections={projections}
      />,
    );
    expect(screen.getByTestId('whatif-projection-tooltip-scenario-1')).toBeInTheDocument();
    expect(screen.getByTestId('whatif-projection-tooltip-scenario-2')).toBeInTheDocument();
    expect(screen.getByText('Baseline')).toBeInTheDocument();
    expect(screen.getByText('Aggressive')).toBeInTheDocument();
  });

  it('omits hidden scenarios (visible: false)', () => {
    const projections = new Map<number, MonthlyState[]>([
      [1, [stateAt('2026-05'), stateAt('2026-06')]],
      [2, [stateAt('2026-05'), stateAt('2026-06')]],
    ]);
    render(
      <DecomposedTooltipContent
        label="2026-06"
        active
        scenarios={[baseline, { ...variant, visible: false }]}
        displayProjections={projections}
      />,
    );
    expect(screen.getByTestId('whatif-projection-tooltip-scenario-1')).toBeInTheDocument();
    expect(screen.queryByTestId('whatif-projection-tooltip-scenario-2')).not.toBeInTheDocument();
  });
});

describe('DecomposedTooltipContent — net change + decomposition rows', () => {
  it('shows the net worth and net change MoM lines', () => {
    const states = [
      stateAt('2026-05', { netWorth: 360_000 }),
      stateAt('2026-06', { netWorth: 365_000, compoundReturnAdded: 2_000, autoInvestedSalarySurplus: 3_000 }),
    ];
    const projections = new Map<number, MonthlyState[]>([[1, states]]);
    render(
      <DecomposedTooltipContent
        label="2026-06"
        active
        scenarios={[baseline]}
        displayProjections={projections}
      />,
    );
    const tooltip = screen.getByTestId('whatif-projection-tooltip');
    expect(tooltip).toHaveTextContent(/Net worth/);
    expect(tooltip).toHaveTextContent(/Net change MoM/);
    expect(tooltip).toHaveTextContent('$365,000');
    expect(tooltip).toHaveTextContent('+$5,000');
  });

  it('omits zero-valued decomposition rows', () => {
    const states = [
      stateAt('2026-05'),
      stateAt('2026-06', {
        compoundReturnAdded: 1_200,        // non-zero → shown
        autoInvestedSalarySurplus: 4_500,  // non-zero → shown
        salarySurplusToCash: 0,             // zero → omitted
        leverContributionsInvested: 0,     // zero → omitted
        lumpSumInvested: 0,                 // zero → omitted
        withdrawnFromInvestments: 0,        // zero → omitted
      }),
    ];
    const projections = new Map<number, MonthlyState[]>([[1, states]]);
    render(
      <DecomposedTooltipContent
        label="2026-06"
        active
        scenarios={[baseline]}
        displayProjections={projections}
      />,
    );
    expect(screen.getByTestId('whatif-projection-tooltip-row-1-compound-return')).toBeInTheDocument();
    expect(screen.getByTestId('whatif-projection-tooltip-row-1-auto-invested-salary')).toBeInTheDocument();
    expect(screen.queryByTestId('whatif-projection-tooltip-row-1-surplus-to-cash')).not.toBeInTheDocument();
    expect(screen.queryByTestId('whatif-projection-tooltip-row-1-lever-contributions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('whatif-projection-tooltip-row-1-lump-sums')).not.toBeInTheDocument();
    expect(screen.queryByTestId('whatif-projection-tooltip-row-1-withdrawals')).not.toBeInTheDocument();
  });

  it('renders the Surplus to cash row when salarySurplusToCash > 0 (auto-invest OFF path)', () => {
    const states = [
      stateAt('2026-05'),
      stateAt('2026-06', {
        compoundReturnAdded: 800,
        autoInvestedSalarySurplus: 0,
        salarySurplusToCash: 3_200,
      }),
    ];
    const projections = new Map<number, MonthlyState[]>([[1, states]]);
    render(
      <DecomposedTooltipContent
        label="2026-06"
        active
        scenarios={[baseline]}
        displayProjections={projections}
      />,
    );
    const row = screen.getByTestId('whatif-projection-tooltip-row-1-surplus-to-cash');
    expect(row).toBeInTheDocument();
    expect(row.textContent).toContain('+$3,200');
    // The Auto-invested salary row is mutually exclusive — engine guarantees
    // exactly one of the two fields is non-zero per step.
    expect(
      screen.queryByTestId('whatif-projection-tooltip-row-1-auto-invested-salary'),
    ).not.toBeInTheDocument();
  });

  it('shows the Withdrawals row with a negative sign when investments are drawn down', () => {
    const states = [
      stateAt('2026-05'),
      stateAt('2026-06', { withdrawnFromInvestments: 5_000 }),
    ];
    const projections = new Map<number, MonthlyState[]>([[1, states]]);
    render(
      <DecomposedTooltipContent
        label="2026-06"
        active
        scenarios={[baseline]}
        displayProjections={projections}
      />,
    );
    const row = screen.getByTestId('whatif-projection-tooltip-row-1-withdrawals');
    expect(row).toBeInTheDocument();
    expect(row.textContent).toMatch(/−\$5,000/); // U+2212 minus, not ASCII hyphen
  });

  it('shows all four "in" rows together when the engine reports each kind of inflow', () => {
    const states = [
      stateAt('2026-05'),
      stateAt('2026-06', {
        compoundReturnAdded: 700,
        autoInvestedSalarySurplus: 3_000,
        leverContributionsInvested: 1_000,
        lumpSumInvested: 20_000,
      }),
    ];
    const projections = new Map<number, MonthlyState[]>([[1, states]]);
    render(
      <DecomposedTooltipContent
        label="2026-06"
        active
        scenarios={[baseline]}
        displayProjections={projections}
      />,
    );
    expect(screen.getByTestId('whatif-projection-tooltip-row-1-compound-return')).toHaveTextContent('+$700');
    expect(screen.getByTestId('whatif-projection-tooltip-row-1-auto-invested-salary')).toHaveTextContent('+$3,000');
    expect(screen.getByTestId('whatif-projection-tooltip-row-1-lever-contributions')).toHaveTextContent('+$1,000');
    expect(screen.getByTestId('whatif-projection-tooltip-row-1-lump-sums')).toHaveTextContent('+$20,000');
  });

  it('omits the Net change row for the seed month (no previous step)', () => {
    const states = [
      stateAt('2026-05'),
      stateAt('2026-06'),
    ];
    const projections = new Map<number, MonthlyState[]>([[1, states]]);
    render(
      <DecomposedTooltipContent
        label="2026-05"  // hover on the SEED step
        active
        scenarios={[baseline]}
        displayProjections={projections}
      />,
    );
    const tooltip = screen.getByTestId('whatif-projection-tooltip');
    expect(tooltip).toHaveTextContent(/Net worth/);
    expect(tooltip).not.toHaveTextContent(/Net change MoM/);
  });

  it('returns null for a label that does not match any projection step', () => {
    const projections = new Map<number, MonthlyState[]>([[1, [stateAt('2026-05'), stateAt('2026-06')]]]);
    render(
      <DecomposedTooltipContent
        label="2099-12"   // not in the projection
        active
        scenarios={[baseline]}
        displayProjections={projections}
      />,
    );
    // The outer tooltip wrapper IS rendered (because there's at least the
    // header row), but the per-scenario block bails out via findStateIndex
    // returning -1 and rendering nothing. We assert there's no row content.
    expect(screen.queryByTestId('whatif-projection-tooltip-scenario-1')).not.toBeInTheDocument();
  });
});

describe('DecomposedTooltipContent — multi-scenario hovers', () => {
  it('renders independent decomposition blocks for each scenario at the same month', () => {
    const baseStates = [
      stateAt('2026-05'),
      stateAt('2026-06', { compoundReturnAdded: 700, autoInvestedSalarySurplus: 3_000 }),
    ];
    const aggrStates = [
      stateAt('2026-05'),
      stateAt('2026-06', { netWorth: 400_000, compoundReturnAdded: 1_400, leverContributionsInvested: 5_000 }),
    ];
    const projections = new Map<number, MonthlyState[]>([[1, baseStates], [2, aggrStates]]);
    render(
      <DecomposedTooltipContent
        label="2026-06"
        active
        scenarios={[baseline, variant]}
        displayProjections={projections}
      />,
    );
    // Baseline has compound + auto-invested; Aggressive has compound + lever-contrib.
    expect(screen.getByTestId('whatif-projection-tooltip-row-1-compound-return')).toHaveTextContent('+$700');
    expect(screen.getByTestId('whatif-projection-tooltip-row-1-auto-invested-salary')).toHaveTextContent('+$3,000');
    expect(screen.queryByTestId('whatif-projection-tooltip-row-1-lever-contributions')).not.toBeInTheDocument();

    expect(screen.getByTestId('whatif-projection-tooltip-row-2-compound-return')).toHaveTextContent('+$1,400');
    expect(screen.getByTestId('whatif-projection-tooltip-row-2-lever-contributions')).toHaveTextContent('+$5,000');
    expect(screen.queryByTestId('whatif-projection-tooltip-row-2-auto-invested-salary')).not.toBeInTheDocument();
  });
});
