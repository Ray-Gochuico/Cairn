import { describe, it, expect, vi } from 'vitest';
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

const updateLeverMock = vi.fn().mockResolvedValue(undefined);
let activeScenarioOverride: number | null = null;
let activeScenarioId: number | null = 1;
let householdRate = 0.04;

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
            returns: { defaultRate: 0.07, overrides: {} },
            income: { perPerson: [{ annualRaiseRate: 0.03, events: [] }] },
            contributions: [],
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
