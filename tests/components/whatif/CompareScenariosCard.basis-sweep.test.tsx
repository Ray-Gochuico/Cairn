import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expectBasisDiscipline } from '../../helpers/basis-discipline';
import {
  CompareScenariosCard,
  COMPARE_BASIS_FIGURES_BL3,
  COMPARE_BASIS_FIGURES_BL1_TRNW,
  COMPARE_BASIS_FIGURES_BL6,
} from '@/components/whatif/CompareScenariosCard';
import { useWhatIfBasisView } from '@/lib/calculators/basis-view';
import { WHATIF_PAGE_ID, __resetDollarBasisForTests, useDollarBasisStore } from '@/lib/calculators/dollar-basis';
import { resolveComparePair } from '@/lib/whatif/plan-review';
import { emptyLeverPayload, type Milestones, type MonthlyState } from '@/lib/scenarios';
import { makeHousehold } from '../../factories';
import type { Scenario } from '@/types/scenario';

vi.mock('@/stores/scenarios-store', () => ({
  useScenariosStore: () => ({ saveCurrentAsScenario: vi.fn().mockResolvedValue(99) }),
}));

const sc = (id: number, over: Partial<Scenario> = {}): Scenario => ({
  id, name: `S${id}`, isBaseline: false, color: '#4f86f7', lineStyle: 'solid',
  visible: true, isActive: false, sortOrder: id, leverPayload: emptyLeverPayload(),
  createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z', ...over,
});
const st = (monthISO: string): MonthlyState => ({
  monthISO, investmentsByAccount: {}, homeEquity: 0, cash: 1, debtByLoan: {},
  netWorth: 1, incomeAfterTax: 0, expenses: 0, savings: 0, events: [],
});
const HH = makeHousehold({ withdrawalRate: 0.04, inflationAssumption: 0.03 });
const PROJECTIONS = new Map([[1, [st('2026-09')]], [2, [st('2026-09')]]]);
const LOAN_B = { ...emptyLeverPayload(), extraLoanPayments: [{ loanId: 1, extraMonthly: 200 }] };

function Harness({ scenarios, milestones }: { scenarios: Scenario[]; milestones: Map<number, Milestones> }) {
  const view = useWhatIfBasisView({ projections: PROJECTIONS, milestones, inflation: 0.03, startISO: '2026-09' });
  return (
    <MemoryRouter>
      <CompareScenariosCard
        scenarios={scenarios}
        projections={PROJECTIONS}
        displayMilestones={view.displayMilestones}
        basis={view.basis}
        household={HH}
        engineContext={{ inflation: 0.03, cashAccountsWithBalances: [], persons: [] }}
        horizonMonths={360}
        displayInflation={0.03}
        deflatorSourceLabel="your household setting"
        loanNames={{ 1: 'Car loan' }}
        pair={resolveComparePair(scenarios, { aId: null, bId: null }, null)}
        onSelectA={() => {}}
        onSelectB={() => {}}
      />
    </MemoryRouter>
  );
}
const OPTS = { pageId: WHATIF_PAGE_ID };

describe('W5.1 basis-audit sweep — Compare scenarios card (three rungs, both bases)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  // v1.7.1 A-5a (4) / C3 chip (c): the three RUNG registries pinned whole, beside their sweeps.
  it('registry shape: the BL-3, BL-1 + TR-NW and BL-6 rung registries, whole', () => {
    expect(COMPARE_BASIS_FIGURES_BL3).toEqual([
      { testId: 'compare-bottom-line', cls: 'convertible' },
      { testId: 'compare-main-difference', cls: 'invariant' },
    ]);
    expect(COMPARE_BASIS_FIGURES_BL1_TRNW).toEqual([
      { testId: 'compare-bottom-line', cls: 'invariant' },
      { testId: 'compare-tradeoff', cls: 'convertible' },
      { testId: 'compare-main-difference', cls: 'invariant' },
    ]);
    expect(COMPARE_BASIS_FIGURES_BL6).toEqual([
      { testId: 'compare-bottom-line', cls: 'convertible' },
      { testId: 'compare-main-difference', cls: 'invariant' },
    ]);
  });

  it("BL-3 bottom line: $205,993 (today's $) ↔ $500,000 (future $); MD_NONE invariant", () => {
    const scenarios = [sc(1, { name: 'Baseline', isBaseline: true, isActive: true, sortOrder: 0 }), sc(2, { name: 'Aggressive payoff' })];
    const milestones = new Map<number, Milestones>([[1, { netWorth30y: 900_000 }], [2, { netWorth30y: 400_000 }]]);
    expectBasisDiscipline(<Harness scenarios={scenarios} milestones={milestones} />, { figures: COMPARE_BASIS_FIGURES_BL3, charts: [] }, OPTS);
  });

  it('BL-1 bottom line (dates) + TR-NW tradeoff (convertible) + a lever $ in Main difference (invariant)', () => {
    const scenarios = [
      sc(1, { name: 'Baseline', isBaseline: true, isActive: true, sortOrder: 0, leverPayload: LOAN_B }),
      sc(2, { name: 'Aggressive payoff' }),
    ];
    const milestones = new Map<number, Milestones>([
      [1, { financialIndependenceISO: '2040-06', netWorth30y: 900_000 }],
      [2, { financialIndependenceISO: '2043-06', netWorth30y: 400_000 }],
    ]);
    expectBasisDiscipline(<Harness scenarios={scenarios} milestones={milestones} />, { figures: COMPARE_BASIS_FIGURES_BL1_TRNW, charts: [] }, OPTS);
  });

  it("BL-6 floor: $10,015 (future $) ↔ $4,126 (today's $) — A3", () => {
    const scenarios = [
      sc(1, { name: 'Baseline', isBaseline: true, isActive: true, sortOrder: 0 }),
      sc(2, { name: 'Aggressive payoff', leverPayload: LOAN_B }),
    ];
    const milestones = new Map<number, Milestones>([[1, { netWorth30y: 2_000_000 }], [2, { netWorth30y: 2_003_000 }]]);
    expectBasisDiscipline(<Harness scenarios={scenarios} milestones={milestones} />, { figures: COMPARE_BASIS_FIGURES_BL6, charts: [] }, OPTS);

    // Review MINOR 9: the sweep is rate-agnostic (it proves future > today and
    // the marks), so the FIGURE and the RUNG are pinned here, at the harness's 3%.
    //   today:  1.03^30 = 2.4272624712;  2,003,000 / 2.4272624712 = 825,209.48 → rounded 825,209
    //           floor = max(500, 0.005 × 825,209) = 4,126.05 → $4,126
    //           (the 2,000,000 side → 823,974; |Δ| = 1,235 < 4,126, so BL-3 cannot fire → BL-6)
    //   future: floor = max(500, 0.005 × 2,003,000) = $10,015; |Δ| = 3,000 < 10,015 → BL-6
    //   (at 2.5% the today floor would be $4,775 — the rate is pinned, not just the direction)
    // The sweep leaves the card mounted with the basis restored to Today.
    const bottomLine = () => screen.getByTestId('compare-bottom-line').textContent;
    expect(bottomLine()).toBe("These plans end within $4,126 of each other over this horizon (today's $).");
    act(() => useDollarBasisStore.getState().setBasis(WHATIF_PAGE_ID, 'future'));
    expect(bottomLine()).toBe('These plans end within $10,015 of each other over this horizon (future $).');
  });
});
