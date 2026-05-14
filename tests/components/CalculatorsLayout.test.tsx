import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';
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
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the baseline cards (Paycheck, Bonus, Commission) when household is set', async () => {
    primeBaseline();
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
    usePersonsStore.setState({
      persons: [
        {
          ...basePerson,
          employmentType: 'HOURLY',
          hourlyRate: 25,
        },
      ],
      isLoading: false,
      error: null,
    });

    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

    // OvertimeCard's title is "Overtime" — should appear in the layout
    expect(await screen.findByText(/^Overtime$/i)).toBeInTheDocument();
  });

  it('renders OvertimeCard when at least one person has employment_type=SALARY_WITH_OT', async () => {
    primeBaseline();
    usePersonsStore.setState({
      persons: [
        {
          ...basePerson,
          employmentType: 'SALARY_WITH_OT',
          annualSalaryPretax: 52000,
        },
      ],
      isLoading: false,
      error: null,
    });

    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

    expect(await screen.findByText(/^Overtime$/i)).toBeInTheDocument();
  });

  it('does NOT render OvertimeCard when all persons have employment_type=SALARY_NO_OT', async () => {
    primeBaseline();
    usePersonsStore.setState({
      persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
      isLoading: false,
      error: null,
    });

    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

    // Page rendered — Bonus card title is visible
    await screen.findByText(/Bonus take-home/i);
    // But the standalone "Overtime" card title must NOT be present
    expect(screen.queryByText(/^Overtime$/i)).not.toBeInTheDocument();
  });

  it('does NOT render OvertimeCard when persons store is empty', async () => {
    primeBaseline();
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });

    render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

    // Page heading still renders
    await screen.findByRole('heading', { name: /Calculators/i });
    expect(screen.queryByText(/^Overtime$/i)).not.toBeInTheDocument();
  });

  describe('stale tax-year banner', () => {
    it('shows stale-year banner when seeded years do not include current calendar year', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2027-03-15'));
      primeBaseline(); // seeds year=2026
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

      expect(await screen.findByText(/using 2026 tax brackets/i)).toBeInTheDocument();
      expect(screen.getByText(/update.*newer rates/i)).toBeInTheDocument();
    });

    it('hides banner when dismissed', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2027-03-15'));
      primeBaseline();
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

      const dismissBtn = await screen.findByRole('button', { name: /dismiss/i });
      await userEvent.click(dismissBtn);
      expect(screen.queryByText(/using 2026 tax brackets/i)).not.toBeInTheDocument();
    });

    it('does NOT show banner when current calendar year is in seeded set', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-01'));
      primeBaseline(); // seeds year=2026
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

      // Page rendered
      await screen.findByText(/Bonus take-home/i);
      // Banner should NOT appear
      expect(screen.queryByText(/using 2026 tax brackets/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('does NOT show banner when seededYears is empty', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2027-03-15'));
      // Do NOT call primeBaseline; tax_rules.items remains []
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
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

      await screen.findByRole('heading', { name: /Calculators/i });
      // No banner — when seededYears is empty, year is null and we don't render
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(/tax brackets/i)).not.toBeInTheDocument();
    });

    it('respects sessionStorage dismissed state across re-renders', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2027-03-15'));
      sessionStorage.setItem('stale-tax-year-banner-dismissed', 'true');
      primeBaseline();
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

      await screen.findByText(/Bonus take-home/i);
      expect(screen.queryByText(/using 2026 tax brackets/i)).not.toBeInTheDocument();
    });

    it('shows the most-recent seeded year, not the next-most-recent', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2027-03-15'));
      // Seed both 2024 and 2025; resolver should pick 2025 (most recent), not 2024
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
      useTaxRulesStore.setState({
        year: 2025,
        items: [
          {
            id: 1,
            year: 2024,
            jurisdictionType: 'FEDERAL',
            jurisdictionCode: 'US',
            filingStatus: FilingStatus.SINGLE,
            brackets: federalSingleBrackets,
            standardDeduction: 14000,
          },
          {
            id: 2,
            year: 2025,
            jurisdictionType: 'FEDERAL',
            jurisdictionCode: 'US',
            filingStatus: FilingStatus.SINGLE,
            brackets: federalSingleBrackets,
            standardDeduction: 14600,
          },
          {
            id: 3,
            year: 2025,
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
      usePersonsStore.setState({
        persons: [{ ...basePerson, employmentType: 'SALARY_NO_OT' }],
        isLoading: false,
        error: null,
      });

      render(<MemoryRouter><CalculatorsLayout /></MemoryRouter>);

      expect(await screen.findByText(/using 2025 tax brackets/i)).toBeInTheDocument();
      expect(screen.queryByText(/using 2024 tax brackets/i)).not.toBeInTheDocument();
    });
  });
});
