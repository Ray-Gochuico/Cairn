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

// Task #25 — auto-invest preview is computed via useAutoInvestPreview() which
// wraps useRealState() + the engine. We mock the hook directly so each test
// can dial in the auto-invest amount without standing up the full store graph.
let autoInvestPreviewValue = 0;
vi.mock('@/components/whatif/useAutoInvestPreview', () => ({
  useAutoInvestPreview: () => autoInvestPreviewValue,
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

describe('LeverBar — Contributions auto-invest pill (Task #25)', () => {
  beforeEach(() => {
    activeScenarioId = 1;
    activeScenarioOverride = null;
    householdRate = 0.04;
    returnsPayload = { defaultRate: 0.07, overrides: {} };
    autoInvestPreviewValue = 0;
  });

  it('shows the Info icon when no segments are set AND auto-invest preview is 0', () => {
    contributionsPayload = [];
    autoInvestPreviewValue = 0;
    render(<LeverBar />);
    expect(screen.getByTestId('contributions-auto-invest-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('contributions-auto-invest-badge')).not.toBeInTheDocument();
  });

  it('shows the auto-invest dollar-amount badge when no segments AND preview > 0', () => {
    contributionsPayload = [];
    autoInvestPreviewValue = 4500;
    render(<LeverBar />);
    const badge = screen.getByTestId('contributions-auto-invest-badge');
    expect(badge).toBeInTheDocument();
    // formatCompactCurrency(4500) → "$4.5k". The badge renders "· auto $4.5k/mo".
    expect(badge.textContent).toContain('auto');
    expect(badge.textContent).toContain('$4.5k');
    expect(badge.textContent).toContain('/mo');
    // When the dollar badge is showing, the Info icon is redundant — hide it.
    expect(screen.queryByTestId('contributions-auto-invest-icon')).not.toBeInTheDocument();
  });

  it('hides BOTH the badge and Info icon when at least one segment exists', () => {
    contributionsPayload = [{ startMonth: 0, endMonth: 59, monthlyAmount: 1000, label: 'Y1-Y5' }];
    autoInvestPreviewValue = 4500;
    render(<LeverBar />);
    expect(screen.queryByTestId('contributions-auto-invest-icon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contributions-auto-invest-badge')).not.toBeInTheDocument();
    // The existing "· N" count display is preserved.
    expect(screen.getByLabelText(/contributions/i).textContent).toContain('· 1');
  });

  it('hides the badge when there is no active scenario (early-return branch)', () => {
    activeScenarioId = null;
    autoInvestPreviewValue = 4500;
    render(<LeverBar />);
    // No active scenario → empty-state message, no buttons at all.
    expect(screen.queryByTestId('contributions-auto-invest-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contributions-auto-invest-icon')).not.toBeInTheDocument();
  });
});
