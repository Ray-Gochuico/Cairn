import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ScenarioBar } from '@/pages/calculators/ScenarioBar';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import { SCENARIO_STORAGE_KEY } from '@/lib/calculators/scenario-assumptions';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';

// Federal SINGLE brackets (2026 approximate) — same fixture as CalculatorsLayout.test.tsx
const federalSingleBrackets = [
  { min: 0,       max: 11925,  rate: 0.10 },
  { min: 11925,   max: 48475,  rate: 0.12 },
  { min: 48475,   max: 103350, rate: 0.22 },
  { min: 103350,  max: 197300, rate: 0.24 },
  { min: 197300,  max: 250525, rate: 0.32 },
  { min: 250525,  max: 626350, rate: 0.35 },
  { min: 626350,  max: null,   rate: 0.37 },
];

const caSingleBrackets = [
  { min: 0,       max: 10412,  rate: 0.01 },
  { min: 10412,   max: 24684,  rate: 0.02 },
  { min: 24684,   max: null,   rate: 0.04 },
];

const basePerson = {
  id: 1,
  householdId: 1,
  name: 'Alex',
  dateOfBirth: '1990-01-01',
  targetRetirementAge: 65,
  annualSalaryPretax: 100000,
  expectedBonus: 0,
  expectedBonusFrequency: 'ANNUAL' as const,
  bonusIsConsistent: true,
  expectedCommission: 0,
  expectedCommissionFrequency: 'MONTHLY' as const,
  pretax401kPct: 0,
  healthInsuranceMonthlyPremium: 0,
  dependentCareFsaMonthly: 0,
  hsaMonthlyContribution: 0,
  hsaEligible: false,
  employmentType: 'SALARY_NO_OT' as const,
  hourlyRate: null,
  regularHoursPerWeek: 40,
  otThresholdHoursPerWeek: 40,
};

function resetStores() {
  // Noop loads so useHouseholdTaxContext's bootstrap effect can't hit a real
  // DB or clobber primed state (same idiom as CalculatorsLayout.test.tsx).
  const noop = async () => {};
  useHouseholdStore.setState({ household: null, isLoading: false, error: null, load: noop } as never);
  usePersonsStore.setState({ persons: [], isLoading: false, error: null, load: noop } as never);
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null, load: noop } as never);
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: noop } as never);
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: noop } as never);
  useContributionsStore.setState({ contributions: [], isLoading: false, error: null, load: noop } as never);
  useSettingsStore.setState({ settings: null, isLoading: false, error: null, load: noop } as never);
  useTaxRulesStore.setState({
    year: null, items: [], isLoading: false, error: null, loadAvailableYears: noop,
  } as never);
}

function primeBaseline() {
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE,
      state: 'CA',
      city: null,
      monthlyExpenseBaseline: 5000,
      withdrawalRate: 0.04,
      inflationAssumption: 0.03,
      growthScenarios: [
        { label: 'Conservative', rate: 0.05 },
        { label: 'Moderate', rate: 0.06 },
        { label: 'Optimistic', rate: 0.07 },
      ],
    },
    isLoading: false,
    error: null,
  });
  usePersonsStore.setState({ persons: [basePerson], isLoading: false, error: null });
  useTaxRulesStore.setState({
    year: 2026,
    items: [
      {
        id: 1, year: 2026, jurisdictionType: 'FEDERAL', jurisdictionCode: 'US',
        filingStatus: FilingStatus.SINGLE, brackets: federalSingleBrackets, standardDeduction: 15000,
      },
      {
        id: 2, year: 2026, jurisdictionType: 'STATE', jurisdictionCode: 'CA',
        filingStatus: FilingStatus.SINGLE, brackets: caSingleBrackets, standardDeduction: 0,
      },
    ],
    isLoading: false,
    error: null,
  });
}

const renderBar = () => render(<MemoryRouter><ScenarioBar /></MemoryRouter>);

describe('ScenarioBar', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetScenarioAssumptionsForTests();
    resetStores();
    primeBaseline();
    // Pin the calendar (Date only — timers stay real for the 150ms debounce +
    // userEvent) so the "2026 tax year" chip is deterministic.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is a labeled region, and is NOT a live region (cards own announcements — W10 T8)', () => {
    renderBar();
    const region = screen.getByRole('region', { name: /your scenario/i });
    expect(region).not.toHaveAttribute('aria-live');
    expect(region.querySelector('[role="status"]')).toBeNull();
    expect(region.querySelector('[aria-live]')).toBeNull();
  });

  it('renders identity chips (filing status · state · tax year · salary) linking to Inputs', () => {
    renderBar();
    const chips = screen.getByTestId('scenario-chips');
    expect(chips.textContent).toContain('Single');
    expect(chips.textContent).toContain('CA');
    expect(chips.textContent).toContain('2026 tax year');
    expect(chips.textContent).toContain('$100,000');
    expect(screen.getByRole('link', { name: /edit in inputs/i })).toHaveAttribute('href', '/inputs');
  });

  it('renders all six labeled fields with prefills and provenance', () => {
    renderBar();
    expect(screen.getByLabelText('Monthly expenses')).toHaveValue(5000);
    expect(screen.getByLabelText('Withdrawal rate')).toHaveValue(4);
    expect(screen.getByLabelText('Return')).toHaveValue(6);
    expect(screen.getByLabelText('Inflation')).toHaveValue(3);
    expect(screen.getByLabelText('Portfolio')).toHaveValue(0);
    expect(screen.getByLabelText('Annual contribution')).toHaveValue(0);
    expect(screen.getByText('your monthly expense baseline')).toBeInTheDocument();
    expect(screen.getByText('your Moderate growth scenario')).toBeInTheDocument();
  });

  it('debounces commits ~150ms (nothing persists per keystroke)', () => {
    vi.useFakeTimers();
    try {
      renderBar();
      fireEvent.change(screen.getByLabelText('Monthly expenses'), { target: { value: '6500' } });
      expect(sessionStorage.getItem(SCENARIO_STORAGE_KEY)).toBeNull(); // not yet
      act(() => vi.advanceTimersByTime(200));
      expect(JSON.parse(sessionStorage.getItem(SCENARIO_STORAGE_KEY)!)).toEqual({ monthlyExpenses: 6500 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('an edited field shows the visible "edited — reset" text tag (never color-only) and the Edited (n) count', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.clear(screen.getByLabelText('Monthly expenses'));
    await user.type(screen.getByLabelText('Monthly expenses'), '6500');
    expect(await screen.findByRole('button', { name: 'Reset Monthly expenses to your data' })).toBeInTheDocument();
    expect(screen.getByTestId('scenario-edited-count')).toHaveTextContent('Edited (1)');
  });

  it('per-field reset restores the default; Reset to my data clears everything', async () => {
    const user = userEvent.setup();
    renderBar();
    const expenses = screen.getByLabelText('Monthly expenses');
    await user.clear(expenses);
    await user.type(expenses, '6500');
    await user.click(await screen.findByRole('button', { name: 'Reset Monthly expenses to your data' }));
    expect(screen.getByLabelText('Monthly expenses')).toHaveValue(5000);

    await user.clear(expenses);
    await user.type(expenses, '7000');
    await user.click(await screen.findByRole('button', { name: /reset to my data/i }));
    expect(screen.getByLabelText('Monthly expenses')).toHaveValue(5000);
    expect(sessionStorage.getItem(SCENARIO_STORAGE_KEY)).toBeNull();
  });

  it('per-field reset hands focus to the field input (the reset button unmounts on activation)', async () => {
    const user = userEvent.setup();
    renderBar();
    const expenses = screen.getByLabelText('Monthly expenses');
    await user.clear(expenses);
    await user.type(expenses, '6500');
    await user.click(
      await screen.findByRole('button', { name: 'Reset Monthly expenses to your data' }),
    );
    // Without the handoff, focus drops to <body> when the button unmounts.
    expect(screen.getByLabelText('Monthly expenses')).toHaveFocus();
  });

  it('Reset to my data hands focus to the first scenario field (the button unmounts at Edited 0)', async () => {
    const user = userEvent.setup();
    renderBar();
    const expenses = screen.getByLabelText('Monthly expenses');
    await user.clear(expenses);
    await user.type(expenses, '7000');
    await user.click(await screen.findByRole('button', { name: /^reset to my data$/i }));
    expect(screen.getByLabelText('Portfolio')).toHaveFocus();
  });

  it('shows the honesty caption verbatim', () => {
    renderBar();
    expect(
      screen.getByText('Edits here are a temporary scenario. Nothing is saved to your data.'),
    ).toBeInTheDocument();
  });
});
