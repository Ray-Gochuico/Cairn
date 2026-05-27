import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LeverBar from '@/components/whatif/LeverBar';

// Mock all the popovers to keep the test focused on pill wiring.
vi.mock('@/components/whatif/levers/ExtraLoanPaymentsPopover', () => ({
  default: () => null,
}));
vi.mock('@/components/whatif/levers/LumpSumsPopover', () => ({
  default: () => null,
}));
vi.mock('@/components/whatif/levers/ExpensePeriodsPopover', () => ({
  default: () => null,
}));
vi.mock('@/components/whatif/levers/ReturnSchedulePopover', () => ({
  default: () => null,
}));
vi.mock('@/components/whatif/levers/IncomePopover', () => ({
  default: () => null,
}));
vi.mock('@/components/whatif/levers/ContributionsPopover', () => ({
  default: () => null,
}));

// The surplus-flow preview hook wraps useRealState() + the engine. We mock
// the hook directly so each test can dial in the per-bucket breakdown without
// standing up the full store graph. The new return shape (post 2026-05-26
// revamp) is { amount, taxAdvantaged, brokerage, cash }; we derive the bucket
// values from the legacy `surplusDestination` toggle to preserve test intent
// while the LeverBar component reads the per-bucket fields directly.
let autoInvestPreviewValue = 0;
let surplusDestination: 'cash' | 'investments' = 'investments';
vi.mock('@/components/whatif/useSurplusFlowPreview', () => ({
  useSurplusFlowPreview: () => {
    if (surplusDestination === 'cash') {
      return {
        amount: autoInvestPreviewValue,
        taxAdvantaged: 0,
        brokerage: 0,
        cash: autoInvestPreviewValue,
      };
    }
    // 'investments' → route the full amount into brokerage for the per-bucket
    // breakdown. The exact tax-adv vs brokerage split doesn't matter for
    // these tests — only "non-cash routing > 0".
    return {
      amount: autoInvestPreviewValue,
      taxAdvantaged: 0,
      brokerage: autoInvestPreviewValue,
      cash: 0,
    };
  },
}));

const updateLeverMock = vi.fn().mockResolvedValue(undefined);
let activeScenarioOverride: number | null = null;
let activeScenarioId: number | null = 1;
let householdRate = 0.04;
// Allows individual tests to override the returns lever payload.
let returnsPayload: { defaultRate: number; overrides: Record<string, number> } = {
  defaultRate: 0.07,
  overrides: {},
};
// Allows individual tests to inject contribution segments.
let contributionsPayload: any[] = [];

vi.mock('@/stores/scenarios-store', () => {
  return {
    useScenariosStore: Object.assign(
      (selector?: any) => {
        const baseline = {
          id: activeScenarioId,
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
            returns: returnsPayload,
            income: { perPerson: [{ annualRaiseRate: 0.03, events: [] }] },
            contributions: contributionsPayload,
            retirementAgeOverride: null,
            swrOverride: activeScenarioOverride,
          },
          createdAt: '',
          updatedAt: '',
        };
        const state = {
          scenarios: activeScenarioId == null ? [] : [baseline],
          updateLever: updateLeverMock,
        };
        return typeof selector === 'function' ? selector(state) : state;
      },
      {
        getState: () => ({
          updateLever: updateLeverMock,
        }),
      },
    ),
  };
});

vi.mock('@/stores/household-store', () => ({
  useHouseholdStore: (selector?: any) => {
    const state = {
      household: { withdrawalRate: householdRate },
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

describe('LeverBar — SWR pill wiring', () => {
  beforeEach(() => {
    returnsPayload = { defaultRate: 0.07, overrides: {} };
    contributionsPayload = [];
  });

  it('renders the SwrLeverPill in the bar', () => {
    activeScenarioId = 1;
    activeScenarioOverride = null;
    householdRate = 0.04;
    render(<LeverBar />);
    expect(screen.getByTestId('swr-lever-pill')).toBeInTheDocument();
  });

  it('SwrLeverPill displays household.withdrawalRate when override is null', () => {
    activeScenarioId = 1;
    activeScenarioOverride = null;
    householdRate = 0.04;
    render(<LeverBar />);
    const input = screen.getByLabelText('SWR percent') as HTMLInputElement;
    expect(input.value).toBe('4.0');
    expect(screen.getByTestId('swr-lever-pill')).toHaveAttribute('data-using-default', 'true');
  });

  it('SwrLeverPill displays scenario override when set', () => {
    activeScenarioId = 1;
    activeScenarioOverride = 0.035;
    householdRate = 0.04;
    render(<LeverBar />);
    const input = screen.getByLabelText('SWR percent') as HTMLInputElement;
    expect(input.value).toBe('3.5');
    expect(screen.getByTestId('swr-lever-pill')).toHaveAttribute('data-using-default', 'false');
  });

  it('reset button calls updateLever with { swrOverride: null }', async () => {
    const user = userEvent.setup();
    activeScenarioId = 1;
    activeScenarioOverride = 0.035;
    householdRate = 0.04;
    updateLeverMock.mockClear();
    render(<LeverBar />);
    await user.click(screen.getByRole('button', { name: /reset SWR/i }));
    expect(updateLeverMock).toHaveBeenCalledWith(1, { swrOverride: null });
  });

  it('does not render the pill when there is no active scenario', () => {
    activeScenarioId = null;
    activeScenarioOverride = null;
    householdRate = 0.04;
    render(<LeverBar />);
    expect(screen.queryByTestId('swr-lever-pill')).toBeNull();
  });
});

describe('LeverBar — Returns default hint', () => {
  beforeEach(() => {
    activeScenarioId = 1;
    activeScenarioOverride = null;
    householdRate = 0.04;
  });

  it('shows the "using default 7%" hint when returns are at the pristine 7% baseline', () => {
    returnsPayload = { defaultRate: 0.07, overrides: {} };
    render(<LeverBar />);
    expect(screen.getByTestId('returns-default-hint')).toBeInTheDocument();
    expect(screen.getByTestId('returns-default-hint')).toHaveTextContent(/using default 7%/i);
  });

  it('hides the hint when defaultRate is customised (e.g. 5%)', () => {
    returnsPayload = { defaultRate: 0.05, overrides: {} };
    render(<LeverBar />);
    expect(screen.queryByTestId('returns-default-hint')).not.toBeInTheDocument();
  });

  it('hides the hint when at least one per-year override is set even if defaultRate is 7%', () => {
    returnsPayload = { defaultRate: 0.07, overrides: { '2026': -0.37 } };
    render(<LeverBar />);
    expect(screen.queryByTestId('returns-default-hint')).not.toBeInTheDocument();
  });
});

describe('LeverBar — Contributions pill (Task β2: branched by surplus destination)', () => {
  beforeEach(() => {
    activeScenarioId = 1;
    activeScenarioOverride = null;
    householdRate = 0.04;
    returnsPayload = { defaultRate: 0.07, overrides: {} };
    autoInvestPreviewValue = 0;
    surplusDestination = 'investments';
  });

  // -------------------------------------------------------------------------
  // destination === 'investments' (autoInvestSalarySurplus = true)
  // -------------------------------------------------------------------------
  it('shows the Info icon when no segments + destination=investments + amount=0', () => {
    contributionsPayload = [];
    autoInvestPreviewValue = 0;
    surplusDestination = 'investments';
    render(<LeverBar />);
    expect(screen.getByTestId('contributions-auto-invest-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('contributions-auto-invest-badge')).not.toBeInTheDocument();
  });

  it('shows the "auto $X/mo" badge when no segments + destination=investments + amount > 0', () => {
    contributionsPayload = [];
    autoInvestPreviewValue = 4500;
    surplusDestination = 'investments';
    render(<LeverBar />);
    const badge = screen.getByTestId('contributions-auto-invest-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('auto');
    expect(badge.textContent).toContain('$4.5k');
    expect(badge.textContent).toContain('/mo');
    expect(screen.queryByTestId('contributions-auto-invest-icon')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // destination === 'cash' (the new default since 2026-05-26)
  // -------------------------------------------------------------------------
  it('shows the cash-hint Info icon when no segments + destination=cash + amount > 0', () => {
    contributionsPayload = [];
    autoInvestPreviewValue = 4500;
    surplusDestination = 'cash';
    render(<LeverBar />);
    // The cash-destination pill replaces the dollar-amount badge with an
    // explanatory Info icon. Tooltip copy: "Surplus is going to cash. Add a
    // segment to invest." (surfaced via the button's title attribute).
    const icon = screen.getByTestId('contributions-cash-hint-icon');
    expect(icon).toBeInTheDocument();
    expect(screen.queryByTestId('contributions-auto-invest-badge')).not.toBeInTheDocument();
    // The pill title carries the hint copy for hover discovery.
    const pill = screen.getByLabelText(/contributions/i);
    expect(pill.getAttribute('title')).toMatch(/going to cash/i);
  });

  it('shows the cash-hint icon when no segments + destination=cash + amount=0 (zero-surplus fallthrough)', () => {
    contributionsPayload = [];
    autoInvestPreviewValue = 0;
    surplusDestination = 'cash';
    render(<LeverBar />);
    // With no surplus and destination=cash, the pill falls back to the
    // generic auto-invest Info icon (pre-β2 behavior preserved).
    expect(screen.getByTestId('contributions-auto-invest-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('contributions-cash-hint-icon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contributions-auto-invest-badge')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Shared invariants — segments active OR no active scenario
  // -------------------------------------------------------------------------
  it('hides all hint UI when at least one segment exists (regardless of destination)', () => {
    contributionsPayload = [{ startMonth: 0, endMonth: 59, monthlyAmount: 1000, label: 'Y1-Y5' }];
    autoInvestPreviewValue = 4500;
    surplusDestination = 'cash';
    render(<LeverBar />);
    expect(screen.queryByTestId('contributions-auto-invest-icon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contributions-auto-invest-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contributions-cash-hint-icon')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/contributions/i).textContent).toContain('· 1');
  });

  it('badge surfaces ROUTED-TO-INVESTMENTS amount, not the full surplus (revamp γ3)', () => {
    // Revamp 2026-05-26 — the per-bucket mock routes the full
    // autoInvestPreviewValue into brokerage when destination='investments',
    // so the badge surfaces $X = the brokerage amount = autoInvestPreviewValue.
    // (A mixed 50/50 cash/brokerage case is covered by the per-bucket
    // breakdown test below.)
    contributionsPayload = [];
    autoInvestPreviewValue = 1500;
    surplusDestination = 'investments';
    render(<LeverBar />);
    const badge = screen.getByTestId('contributions-auto-invest-badge');
    expect(badge.textContent).toContain('$1.5k');
  });

  it('pill title surfaces the per-bucket routing copy (revamp γ3)', () => {
    contributionsPayload = [];
    autoInvestPreviewValue = 1500;
    surplusDestination = 'investments';
    render(<LeverBar />);
    const pill = screen.getByLabelText(/contributions/i);
    expect(pill.getAttribute('title')).toMatch(/surplus.*routes/i);
  });

  it('renders nothing for the pill region when there is no active scenario (early-return branch)', () => {
    activeScenarioId = null;
    autoInvestPreviewValue = 4500;
    surplusDestination = 'investments';
    render(<LeverBar />);
    expect(screen.queryByTestId('contributions-auto-invest-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contributions-auto-invest-icon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contributions-cash-hint-icon')).not.toBeInTheDocument();
  });
});
