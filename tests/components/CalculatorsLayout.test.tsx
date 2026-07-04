import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { useSettingsStore } from '@/stores/settings-store';
import { FilingStatus } from '@/types/enums';
import type { AppSettings } from '@/types/schema';
import CalculatorsLayout from '@/pages/calculators/CalculatorsLayout';

// Federal SINGLE brackets (2026 approximate) — same fixture as BonusTaxCard.test.tsx
const federalSingleBrackets = [
  { min: 0,       max: 11925,  rate: 0.10 },
  { min: 11925,   max: 48475,  rate: 0.12 },
  { min: 48475,   max: 103350, rate: 0.22 },
  { min: 103350,  max: 197300, rate: 0.24 },
  { min: 197300,  max: 250525, rate: 0.32 },
  { min: 250525,  max: 626350, rate: 0.35 },
  { min: 626350,  max: null,   rate: 0.37 },
];

// CA SINGLE brackets (2026 approximate)
const caSingleBrackets = [
  { min: 0,       max: 10412,  rate: 0.01 },
  { min: 10412,   max: 24684,  rate: 0.02 },
  { min: 24684,   max: 38959,  rate: 0.04 },
  { min: 38959,   max: 54081,  rate: 0.06 },
  { min: 54081,   max: 68350,  rate: 0.08 },
  { min: 68350,   max: 349137, rate: 0.093 },
  { min: 349137,  max: 418961, rate: 0.103 },
  { min: 418961,  max: 698271, rate: 0.113 },
  { min: 698271,  max: null,   rate: 0.123 },
];

const basePerson = {
  id: 1,
  householdId: 1,
  name: 'Alex',
  dateOfBirth: '1990-01-01',
  targetRetirementAge: 65,
  annualSalaryPretax: 100000,
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

// settings.update is exercised by the toggle tests; stub it to mutate the
// in-memory store so the grid reflects the change (no real DB here).
function primeSettings(calculatorCardLayout: AppSettings['calculatorCardLayout'] = null) {
  const update = vi.fn(async (patch: Partial<AppSettings>) => {
    useSettingsStore.setState((s) => ({
      settings: s.settings ? { ...s.settings, ...patch } : s.settings,
    }));
  });
  useSettingsStore.setState({
    settings: {
      id: 1,
      sidebarLayout: null,
      investmentsCardLayout: null,
      calculatorCardLayout,
      notificationsEnabled: true,
      notificationDay: 1,
      refreshCadence: 'DAILY',
      lastRefreshAt: null,
      statementsFolderPath: null,
      defaultInflation: null,
      defaultReturnRate: null,
      defaultFiPillsPosition: 'above',
      defaultProjectionDetailLevel: 'tax_bucket',
      defaultCashApy: null,
      defaultCompoundingFrequency: 'MONTHLY',
      defaultDrawdownTaxRate: null,
      propertyUtilitiesCategoryIds: null,
      vehicleGasCategoryIds: null,
      assetClassTargetAllocations: null,
      lastSeenMonth: null,
    } as AppSettings,
    isLoading: false,
    error: null,
    // Override the action so toggles don't hit a real repo.
    update: update as unknown as AppSettings extends never ? never : SettingsUpdate,
  });
  return update;
}
type SettingsUpdate = (patch: Partial<Omit<AppSettings, 'id'>>) => Promise<void>;

function resetStores() {
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
  useTaxRulesStore.setState({ year: null, items: [], isLoading: false, error: null });
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
      growthScenarios: [],
    },
    isLoading: false,
    error: null,
  });
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
  useTaxRulesStore.setState({
    year: 2026,
    items: [
      {
        id: 1,
        year: 2026,
        jurisdictionType: 'FEDERAL',
        jurisdictionCode: 'US',
        filingStatus: FilingStatus.SINGLE,
        brackets: federalSingleBrackets,
        standardDeduction: 15000,
      },
      {
        id: 2,
        year: 2026,
        jurisdictionType: 'STATE',
        jurisdictionCode: 'CA',
        filingStatus: FilingStatus.SINGLE,
        brackets: caSingleBrackets,
        standardDeduction: 0,
      },
    ],
    isLoading: false,
    error: null,
  });
}

describe('CalculatorsLayout', () => {
  beforeEach(() => {
    resetStores();
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the baseline cards (Paycheck, Bonus, Commission) when settings + household are set', async () => {
    primeBaseline();
    primeSettings();
    usePersonsStore.setState({
      persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
      isLoading: false,
      error: null,
    });

    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

    expect(await screen.findByText(/Paycheck/i)).toBeInTheDocument();
    expect(screen.getByText(/Bonus take-home/i)).toBeInTheDocument();
    expect(screen.getByText(/Commission take-home/i)).toBeInTheDocument();
  });

  it('renders OvertimeCard when at least one person has employment_type=HOURLY', async () => {
    primeBaseline();
    primeSettings();
    usePersonsStore.setState({
      persons: [{ ...basePerson, employmentType: 'HOURLY', hourlyRate: 25 }],
      isLoading: false,
      error: null,
    });

    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

    expect(await screen.findByText(/^Overtime$/i)).toBeInTheDocument();
  });

  it('does NOT render OvertimeCard when all persons have employment_type=SALARY_NO_OT', async () => {
    primeBaseline();
    primeSettings();
    usePersonsStore.setState({
      persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
      isLoading: false,
      error: null,
    });

    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

    await screen.findByText(/Bonus take-home/i);
    expect(screen.queryByText(/^Overtime$/i)).not.toBeInTheDocument();
  });

  describe('stale tax-year banner', () => {
    it('shows stale-year banner when seeded years do not include current calendar year', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2027-03-15'));
      primeBaseline();
      primeSettings();
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

      expect(await screen.findByText(/using 2026 tax brackets/i)).toBeInTheDocument();
    });

    it('does NOT show banner when current calendar year is in seeded set', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-01'));
      primeBaseline();
      primeSettings();
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

      await screen.findByText(/Bonus take-home/i);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('Hide / show cards (DB-backed, Switch popover)', () => {
    it('per-card Hide button writes calculatorCardLayout via settings.update (not localStorage)', async () => {
      primeBaseline();
      const update = primeSettings();
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
      await screen.findByText(/Bonus take-home/i);

      const bonusHide = screen.getByRole('button', { name: /^hide estimated bonus take-home/i });
      await userEvent.click(bonusHide);

      // update() called with a calculatorCardLayout marking bonus-tax hidden.
      expect(update).toHaveBeenCalled();
      const patch = update.mock.calls.at(-1)![0] as { calculatorCardLayout: { id: string; hidden: boolean }[] };
      const bonusEntry = patch.calculatorCardLayout.find((e) => e.id === 'bonus-tax');
      expect(bonusEntry?.hidden).toBe(true);
      // Card removed from the grid.
      expect(screen.queryByText(/Bonus take-home/i)).not.toBeInTheDocument();
      // Single source of truth: localStorage key NEVER recreated.
      expect(localStorage.getItem('calculator-hidden-cards')).toBeNull();
    });

    it('hides a card sourced from settings.calculatorCardLayout (DB read path)', async () => {
      primeBaseline();
      primeSettings([{ id: 'bonus-tax', hidden: true }]);
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

      await screen.findByText(/Paycheck/i);
      expect(screen.queryByText(/Bonus take-home/i)).not.toBeInTheDocument();
    });

    it('manage popover lists all 12 cards as Switches; toggling one off hides it via update', async () => {
      primeBaseline();
      const update = primeSettings();
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
      await screen.findByText(/Bonus take-home/i);

      await userEvent.click(screen.getByRole('button', { name: /manage cards/i }));

      // All 12 cards present as labeled switches.
      const switches = screen.getAllByRole('switch');
      expect(switches).toHaveLength(12);

      // Toggle "Compound Interest" off.
      const compoundSwitch = screen.getByRole('switch', { name: /compound interest/i });
      await userEvent.click(compoundSwitch);

      const patch = update.mock.calls.at(-1)![0] as { calculatorCardLayout: { id: string; hidden: boolean }[] };
      expect(patch.calculatorCardLayout.find((e) => e.id === 'compound-interest')?.hidden).toBe(true);
      expect(screen.queryByText(/Compound Interest/i)).not.toBeInTheDocument();
      expect(localStorage.getItem('calculator-hidden-cards')).toBeNull();
    });

    it('toggling a hidden card back on (Switch) restores it via update', async () => {
      primeBaseline();
      const update = primeSettings([{ id: 'bonus-tax', hidden: true }]);
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
      await screen.findByText(/Paycheck/i);
      expect(screen.queryByText(/Bonus take-home/i)).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /manage cards/i }));
      await userEvent.click(screen.getByRole('switch', { name: /bonus tax/i }));

      const patch = update.mock.calls.at(-1)![0] as { calculatorCardLayout: { id: string; hidden: boolean }[] };
      expect(patch.calculatorCardLayout.find((e) => e.id === 'bonus-tax')?.hidden).toBe(false);
      expect(await screen.findByText(/Bonus take-home/i)).toBeInTheDocument();
    });

    it('Escape closes Manage cards and restores focus to the footer trigger', async () => {
      primeBaseline();
      primeSettings();
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
      const trigger = await screen.findByRole('button', { name: /manage cards/i });
      await userEvent.click(trigger);
      expect(screen.getByRole('dialog', { name: /manage calculator cards/i })).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: /manage calculator cards/i })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it('shows "1 card hidden" hint in the footer when one card is hidden', async () => {
      primeBaseline();
      primeSettings([{ id: 'bonus-tax', hidden: true }]);
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
      expect(await screen.findByText(/1 card hidden/i)).toBeInTheDocument();
    });
  });

  it('Commission card id in layout matches card fallback (commission-tax)', async () => {
    primeBaseline();
    primeSettings();
    usePersonsStore.setState({
      persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
      isLoading: false,
      error: null,
    });

    sessionStorage.setItem('calc-state:commission-tax', JSON.stringify({ annualCommission: 99999 }));

    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);
    await screen.findByText(/Commission take-home/i);

    expect(sessionStorage.getItem('calc-state:commission-tax')).not.toBeNull();
    expect(sessionStorage.getItem('calc-state:commission')).toBeNull();
  });

  it('intro copy describes edit/reset and links to What-If', async () => {
    primeBaseline();
    primeSettings();
    usePersonsStore.setState({
      persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
      isLoading: false,
      error: null,
    });

    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

    await screen.findByRole('heading', { name: /Calculators/i });
    expect(screen.getByText(/Reset to my data/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /What-If/i })).toHaveAttribute('href', '/what-if');
  });
});
