import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WhatIf from '@/pages/WhatIf';
import { FiPillsPosition } from '@/types/enums';
import { useSettingsStore } from '@/stores/settings-store';
import { seedWhatIfRealStores } from './whatif-store-seed';
import type { Household, Person } from '@/types/schema';

// Stub the visual children so the test focuses on the page-level layout.
// We DO let FiCards render for real so `whatif-fi-cards-wrap` is present and
// the cards' content (testids) is queryable.
vi.mock('@/components/whatif/ProjectionChart', () => ({
  default: () => <div data-testid="projection-chart-stub" />,
}));
vi.mock('@/components/whatif/MilestoneStrip', () => ({
  default: () => <div data-testid="milestone-strip-stub" />,
}));
vi.mock('@/components/whatif/ChartToolbar', () => ({
  default: () => <div data-testid="chart-toolbar-stub" />,
}));
vi.mock('@/components/whatif/LeverBar', () => ({
  default: () => <div data-testid="lever-bar-stub" />,
}));
vi.mock('@/components/whatif/ScenariosPanel', () => ({
  default: () => <div data-testid="scenarios-panel-stub" />,
  ScenariosPanel: () => <div data-testid="scenarios-panel-stub" />,
}));

const householdFixture: Household = {
  id: 1,
  name: null,
  filingStatus: 'SINGLE',
  state: 'CA',
  city: null,
  monthlyExpenseBaseline: 4000,
  withdrawalRate: 0.04,
  inflationAssumption: 0.025,
  growthScenarios: [
    { label: 'Conservative', rate: 0.04 },
    { label: 'Moderate', rate: 0.06 },
  ],
  interestThresholdLowPct: null,
  interestThresholdHighPct: null,
  hasWrittenIps: null,
  hasHsaQualifiedHdhp: null,
  makesCharitableGifts: null,
  upcomingLargePurchase: null,
  upcomingPurchaseAmount: null,
  upcomingPurchaseMonths: null,
} as Household;

const personFixture = {
  id: 1,
  householdId: 1,
  name: 'P1',
  dateOfBirth: '1990-01-01',
  targetRetirementAge: 65,
  annualSalaryPretax: 100000,
  expectedBonus: 0,
} as unknown as Person;

vi.mock('@/components/whatif/useRealState', () => ({
  useRealState: () => ({
    startISO: '2026-05-01',
    cash: 0,
    investmentsByAccount: { 1: 100000 },
    homeEquity: 0,
    incomeAfterTax: 7000,
    expenses: 4000,
    debtByLoan: {},
    loans: [],
    persons: [personFixture],
    inflation: 0.025,
    defaultReturnRate: 0.07,
  }),
}));

vi.mock('@/stores/scenarios-store', () => {
  const baseline = {
    id: 1,
    name: 'Baseline',
    isBaseline: true,
    color: '#4f86f7',
    lineStyle: 'solid',
    visible: true,
    isActive: true,
    sortOrder: 0,
    leverPayload: {
      extraLoanPayments: [],
      lumpSums: [],
      expensePeriods: [],
      returns: { defaultRate: 0.07, overrides: {} },
      income: { perPerson: [{ annualRaiseRate: 0.03, events: [] }] },
      contributions: [],
    },
    createdAt: '',
    updatedAt: '',
  };
  const seedState = {
    monthISO: '2026-05',
    investmentsByAccount: { 1: 200_000 },
    homeEquity: 0,
    cash: 50_000,
    debtByLoan: {},
    netWorth: 250_000,
    incomeAfterTax: 0,
    expenses: 0,
    savings: 0,
    events: [],
  };
  return {
    useScenariosStore: (selector?: any) => {
      const state = {
        scenarios: [baseline],
        activeScenario: () => baseline,
        visibleScenarioIds: () => [1],
        load: vi.fn(),
        projectedScenarios: () => new Map([[1, [seedState]]]),
        dollarMode: 'nominal',
        inflation: 0.025,
        horizonMonths: 360,
        toggleVisibility: vi.fn(),
        setActive: vi.fn(),
        duplicate: vi.fn(),
        remove: vi.fn(),
        rename: vi.fn(),
        saveCurrentAsScenario: vi.fn().mockResolvedValue(2),
      };
      return typeof selector === 'function' ? selector(state) : state;
    },
  };
});

vi.mock('@/stores/loans-store', () => ({
  useLoansStore: (selector?: any) => {
    const state = { loans: [], isLoading: false, error: null, load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/stores/household-store', () => ({
  useHouseholdStore: (selector?: any) => {
    const state = { household: householdFixture, load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/stores/persons-store', () => ({
  usePersonsStore: (selector?: any) => {
    const state = { persons: [personFixture], load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

function setPosition(position: FiPillsPosition) {
  useSettingsStore.setState({
    settings: {
      id: 1,
      sidebarLayout: null,
      notificationsEnabled: true,
      notificationDay: 1,
      refreshCadence: 'EVERY_LAUNCH',
      lastRefreshAt: null,
      statementsFolderPath: null,
      defaultInflation: null,
      defaultReturnRate: null,
      defaultFiPillsPosition: position,
    },
    isLoading: false,
    error: null,
    load: async () => {},
    update: async () => {},
  } as any);
}

describe('WhatIf — FI pills layout', () => {
  beforeEach(() => {
    seedWhatIfRealStores();
    setPosition(FiPillsPosition.ABOVE);
  });

  it('renders FiCards before the projection chart when setting = "above"', () => {
    setPosition(FiPillsPosition.ABOVE);
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    const wrap = screen.getByTestId('whatif-page-wrap');
    const fiCards = within(wrap).getByTestId('whatif-fi-cards-wrap');
    const chart = within(wrap).getByTestId('whatif-projection-chart-wrap');
    // FI cards must come before the chart in DOM order.
    expect(
      fiCards.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders the projection chart before FiCards when setting = "below"', () => {
    setPosition(FiPillsPosition.BELOW);
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    const wrap = screen.getByTestId('whatif-page-wrap');
    const fiCards = within(wrap).getByTestId('whatif-fi-cards-wrap');
    const chart = within(wrap).getByTestId('whatif-projection-chart-wrap');
    // Chart must come before the FI cards in DOM order.
    expect(
      chart.compareDocumentPosition(fiCards) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('inline chevron toggle flips the order without updating settings', () => {
    setPosition(FiPillsPosition.ABOVE);
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    // Pre-flip: cards before chart.
    const wrap0 = screen.getByTestId('whatif-page-wrap');
    const fi0 = within(wrap0).getByTestId('whatif-fi-cards-wrap');
    const chart0 = within(wrap0).getByTestId('whatif-projection-chart-wrap');
    expect(
      fi0.compareDocumentPosition(chart0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Click the chevron toggle.
    fireEvent.click(screen.getByRole('button', { name: /move pills below charts/i }));

    // Post-flip: chart before cards.
    const wrap1 = screen.getByTestId('whatif-page-wrap');
    const fi1 = within(wrap1).getByTestId('whatif-fi-cards-wrap');
    const chart1 = within(wrap1).getByTestId('whatif-projection-chart-wrap');
    expect(
      chart1.compareDocumentPosition(fi1) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Persisted settings remain "above" (override is session-only).
    expect(useSettingsStore.getState().settings?.defaultFiPillsPosition).toBe(
      FiPillsPosition.ABOVE,
    );
  });

  it('override resets on remount (re-reads the household default)', () => {
    setPosition(FiPillsPosition.ABOVE);
    const { unmount } = render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    // Flip via the chevron.
    fireEvent.click(screen.getByRole('button', { name: /move pills below charts/i }));
    const wrapAfterFlip = screen.getByTestId('whatif-page-wrap');
    const fiAfter = within(wrapAfterFlip).getByTestId('whatif-fi-cards-wrap');
    const chartAfter = within(wrapAfterFlip).getByTestId('whatif-projection-chart-wrap');
    expect(
      chartAfter.compareDocumentPosition(fiAfter) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Unmount + re-mount — should re-read 'above' from settings.
    unmount();
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    const wrap2 = screen.getByTestId('whatif-page-wrap');
    const fi2 = within(wrap2).getByTestId('whatif-fi-cards-wrap');
    const chart2 = within(wrap2).getByTestId('whatif-projection-chart-wrap');
    expect(
      fi2.compareDocumentPosition(chart2) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('WhatIf — projection footnote (W7-Legal R-LWI-4)', () => {
  beforeEach(() => {
    seedWhatIfRealStores();
    setPosition(FiPillsPosition.ABOVE);
  });

  it('renders the page-level footnote naming the modeling omissions', () => {
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    const footnote = screen.getByTestId('whatif-projection-footnote');
    expect(footnote).toBeInTheDocument();
    // Heading line.
    expect(
      within(footnote).getByText(/what this projection doesn.t model/i),
    ).toBeInTheDocument();
    // Bullets: sequence-of-returns risk, Medicare/IRMAA, Roth ladder.
    expect(
      within(footnote).getByText(/sequence-of-returns risk/i),
    ).toBeInTheDocument();
    expect(
      within(footnote).getByText(/IRMAA/i),
    ).toBeInTheDocument();
    expect(
      within(footnote).getByText(/Roth-conversion ladder timing/i),
    ).toBeInTheDocument();
    expect(
      within(footnote).getByText(/5-year seasoning rule/i),
    ).toBeInTheDocument();
    // Wave 2 §5: flat property/vehicle values are disclosed.
    expect(
      within(footnote).getByText(/property & vehicle appreciation/i),
    ).toBeInTheDocument();
    // Pointer to full disclosures.
    expect(
      within(footnote).getByText(/full model assumptions/i),
    ).toBeInTheDocument();
    // The backtest cross-link notes it runs before withdrawal tax (Task 4).
    expect(
      within(footnote).getByText(/before withdrawal tax/i),
    ).toBeInTheDocument();
  });

  it('renders the footnote after the milestone strip in DOM order', () => {
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    const wrap = screen.getByTestId('whatif-page-wrap');
    const milestoneStrip = within(wrap).getByTestId('milestone-strip-stub');
    const footnote = within(wrap).getByTestId('whatif-projection-footnote');
    expect(
      milestoneStrip.compareDocumentPosition(footnote) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('projection footnote discloses the Roth tax-free modeling caveat', () => {
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    const footnote = screen.getByTestId('whatif-projection-footnote');
    expect(footnote.textContent).toMatch(/Roth withdrawals/i);
    expect(footnote.textContent).toMatch(/qualified distributions/i);
    expect(footnote.textContent).toMatch(/59½|59\.5|5-year/i);
  });
});
