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

// Projection-chart tooltip decomposition. Rewritten 2026-05-26 for the gap
// allocation revamp — the legacy `autoInvestedSalarySurplus` and
// `salarySurplusToCash` fields were replaced by three `gapTo*` rows (tax-
// advantaged, brokerage, cash).
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
    gapToTaxAdvantaged: 0,
    gapToBrokerage: 0,
    gapToCash: 0,
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
      gapToTaxAdvantaged: 2_000,
      gapToBrokerage: 1_000,
      gapToCash: 1_500,
      leverContributionsInvested: 0,
      lumpSumInvested: 20_000,
      withdrawnFromInvestments: 0,
    });
    const rows = decomposeStep(state);
    // The three gap rows live between the compound return and the lever
    // contributions row so the user reads the gap-allocation routing in one
    // visual block.
    expect(rows.map((r) => r.label)).toEqual([
      'Compound return',
      'Gap → Tax-advantaged',
      'Gap → Brokerage',
      'Gap → Cash',
      'Lever contributions',
      'Lump sums',
      'Withdrawals',
    ]);
    expect(rows[0].value).toBe(1_200);
    expect(rows[5].value).toBe(20_000);
    expect(rows[6].direction).toBe('out');
  });

  it('defaults missing fields to 0 (the seed state has no decomposition)', () => {
    const state = stateAt('2026-05', {
      compoundReturnAdded: undefined,
      gapToTaxAdvantaged: undefined,
      gapToBrokerage: undefined,
      gapToCash: undefined,
      leverContributionsInvested: undefined,
      lumpSumInvested: undefined,
      withdrawnFromInvestments: undefined,
    });
    const rows = decomposeStep(state);
    for (const row of rows) {
      expect(row.value).toBe(0);
    }
  });

  it('emits a "Gap → Tax-advantaged" row when gapToTaxAdvantaged > 0', () => {
    const rows = decomposeStep(stateAt('2026-06', { gapToTaxAdvantaged: 800 }));
    expect(rows.find((r) => /tax-advantaged/i.test(r.label))?.value).toBe(800);
  });

  it('emits a "Gap → Brokerage" row when gapToBrokerage > 0', () => {
    const rows = decomposeStep(stateAt('2026-06', { gapToBrokerage: 400 }));
    expect(rows.find((r) => /brokerage/i.test(r.label))?.value).toBe(400);
  });

  it('emits a "Gap → Cash" row when gapToCash > 0', () => {
    const rows = decomposeStep(stateAt('2026-06', { gapToCash: 300 }));
    expect(rows.find((r) => /gap.*cash/i.test(r.label))?.value).toBe(300);
  });

  it('does NOT emit the legacy "Auto-invested salary" or "Surplus to cash" rows', () => {
    const rows = decomposeStep(stateAt('2026-06', { gapToCash: 500 }));
    expect(rows.find((r) => /auto-invested salary/i.test(r.label))).toBeUndefined();
    expect(rows.find((r) => /^surplus to cash$/i.test(r.label))).toBeUndefined();
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
      stateAt('2026-06', { netWorth: 365_000, compoundReturnAdded: 2_000, gapToTaxAdvantaged: 3_000 }),
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
        gapToTaxAdvantaged: 4_500,         // non-zero → shown
        gapToBrokerage: 0,                 // zero → omitted
        gapToCash: 0,                       // zero → omitted
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
    const tooltip = screen.getByTestId('whatif-projection-tooltip');
    expect(tooltip).toHaveTextContent(/Compound return/);
    expect(tooltip).toHaveTextContent(/Gap → Tax-advantaged/);
    expect(tooltip).not.toHaveTextContent(/Gap → Brokerage/);
    expect(tooltip).not.toHaveTextContent(/Gap → Cash/);
    expect(tooltip).not.toHaveTextContent(/Lever contributions/);
    expect(tooltip).not.toHaveTextContent(/Lump sums/);
    expect(tooltip).not.toHaveTextContent(/Withdrawals/);
  });

  it('renders the Gap → Cash row when gapToCash > 0', () => {
    const states = [
      stateAt('2026-05'),
      stateAt('2026-06', {
        compoundReturnAdded: 800,
        gapToCash: 3_200,
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
    const tooltip = screen.getByTestId('whatif-projection-tooltip');
    expect(tooltip).toHaveTextContent(/Gap → Cash/);
    expect(tooltip).toHaveTextContent('+$3,200');
    // The three gap rows are independent; tax-advantaged/brokerage stay hidden
    // when their values are 0.
    expect(tooltip).not.toHaveTextContent(/Gap → Tax-advantaged/);
    expect(tooltip).not.toHaveTextContent(/Gap → Brokerage/);
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
    const tooltip = screen.getByTestId('whatif-projection-tooltip');
    expect(tooltip).toHaveTextContent(/Withdrawals/);
    expect(tooltip.textContent).toMatch(/−\$5,000/); // U+2212 minus, not ASCII hyphen
  });

  it('shows all gap rows simultaneously when the engine reports each non-zero', () => {
    const states = [
      stateAt('2026-05'),
      stateAt('2026-06', {
        compoundReturnAdded: 700,
        gapToTaxAdvantaged: 2_000,
        gapToBrokerage: 1_000,
        gapToCash: 500,
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
    const tooltip = screen.getByTestId('whatif-projection-tooltip');
    expect(tooltip).toHaveTextContent(/Compound return.*\+\$700/s);
    expect(tooltip).toHaveTextContent(/Gap → Tax-advantaged.*\+\$2,000/s);
    expect(tooltip).toHaveTextContent(/Gap → Brokerage.*\+\$1,000/s);
    expect(tooltip).toHaveTextContent(/Gap → Cash.*\+\$500/s);
    expect(tooltip).toHaveTextContent(/Lever contributions.*\+\$1,000/s);
    expect(tooltip).toHaveTextContent(/Lump sums.*\+\$20,000/s);
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
      stateAt('2026-06', { compoundReturnAdded: 700, gapToTaxAdvantaged: 3_000 }),
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
    const block1 = screen.getByTestId('whatif-projection-tooltip-scenario-1');
    const block2 = screen.getByTestId('whatif-projection-tooltip-scenario-2');
    // Baseline has compound + gap → tax-advantaged; Aggressive has compound + lever-contrib.
    expect(block1).toHaveTextContent(/Compound return.*\+\$700/s);
    expect(block1).toHaveTextContent(/Gap → Tax-advantaged.*\+\$3,000/s);
    expect(block1).not.toHaveTextContent(/Lever contributions/);

    expect(block2).toHaveTextContent(/Compound return.*\+\$1,400/s);
    expect(block2).toHaveTextContent(/Lever contributions.*\+\$5,000/s);
    expect(block2).not.toHaveTextContent(/Gap → Tax-advantaged/);
  });
});
