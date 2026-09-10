import { describe, it, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { expectBasisDiscipline } from '../../helpers/basis-discipline';
import { ManageScenariosModal, MANAGE_SCENARIOS_BASIS_FIGURES } from '@/components/whatif/ManageScenariosModal';
import { useWhatIfBasisView } from '@/lib/calculators/basis-view';
import { WHATIF_PAGE_ID, __resetDollarBasisForTests } from '@/lib/calculators/dollar-basis';
import { emptyLeverPayload, type Milestones, type MonthlyState } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';

// Fixtures + store mocks copied from ManageScenariosModal.test.tsx — scenarioA
// keeps its extraLoanPayments lever so `manage-levers` renders a $ figure.
const baseline: Scenario = {
  id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid',
  visible: true, isActive: true, sortOrder: 0, leverPayload: emptyLeverPayload(),
  createdAt: '2026-05-24T00:00:00Z', updatedAt: '2026-05-24T00:00:00Z',
};
const scenarioA: Scenario = {
  id: 2, name: 'Aggressive payoff', isBaseline: false, color: '#f59e0b', lineStyle: 'dashed',
  visible: true, isActive: false, sortOrder: 1,
  leverPayload: { ...emptyLeverPayload(), extraLoanPayments: [{ loanId: 1, extraMonthly: 300 }] },
  createdAt: '2026-05-24T00:00:00Z', updatedAt: '2026-05-24T00:00:00Z',
};

vi.mock('@/stores/scenarios-store', () => ({
  useScenariosStore: () => ({
    scenarios: [baseline, scenarioA],
    activeScenario: () => baseline,
    duplicate: vi.fn(),
    remove: vi.fn(),
    setActive: vi.fn(),
    saveCurrentAsScenario: vi.fn(),
    rename: vi.fn(),
  }),
}));

vi.mock('@/stores/loans-store', () => ({
  useLoansStore: () => ({
    loans: [{ id: 1, name: 'Auto loan', balance: 18400, rate: 0.059, monthlyPayment: 425 }],
  }),
}));

const MILESTONES = new Map<number, Milestones>([
  [1, { debtFreeISO: '2029-06', financialIndependenceISO: '2042-04', netWorth30y: 2_345_000 }],
  [2, { debtFreeISO: '2028-02', financialIndependenceISO: '2041-09', netWorth30y: 2_550_000 }],
]);
const PROJECTIONS = new Map<number, MonthlyState[]>();

function Harness() {
  const view = useWhatIfBasisView({ projections: PROJECTIONS, milestones: MILESTONES, inflation: 0.025, startISO: '2026-05' });
  return (
    <MemoryRouter>
      <ManageScenariosModal
        milestones={MILESTONES}
        netWorth30yFmt={view.netWorth30yFmt}
        basisSuffix={view.suffix}
        onClose={() => {}}
      />
    </MemoryRouter>
  );
}

describe('W5.1 basis-audit sweep — Manage scenarios scoreboard (portaled; both bases)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  it('every 30y NW cell flips $1,117,962 → $2,345,000 with its mark; the levers cell is byte-identical; no loose $', () => {
    expectBasisDiscipline(
      <Harness />,
      { figures: MANAGE_SCENARIOS_BASIS_FIGURES, charts: [] },
      { pageId: WHATIF_PAGE_ID, root: document.body },
    );
  });
});
