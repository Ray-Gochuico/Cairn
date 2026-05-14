import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PaycheckCard } from '@/pages/calculators/PaycheckCard';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';

// Federal SINGLE brackets (2026 approximate) — same as BonusTaxCard.test.tsx
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

function resetStores() {
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
  useTaxRulesStore.setState({ year: null, items: [], isLoading: false, error: null });
}

function primeStores() {
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
    persons: [
      {
        id: 1,
        householdId: 1,
        name: 'Alice',
        dateOfBirth: '1990-01-01',
        targetRetirementAge: 65,
        annualSalaryPretax: 100000,
        expectedBonus: 10000,
        pretax401kPct: 0,
        healthInsuranceMonthlyPremium: 0,
        dependentCareFsaMonthly: 0,
        hsaMonthlyContribution: 0,
        hsaEligible: false,
      },
    ],
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

describe('PaycheckCard', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders monthly take-home by default for $100k CA SINGLE', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <PaycheckCard />
      </MemoryRouter>,
    );

    const headline = await screen.findByTestId('paycheck-takehome');
    // $100k salary CA SINGLE: federal ~$13,841, CA ~$5,400, FICA $7,650, total ~$26,900
    // Take-home ~$73,100 annually → ~$6,092 monthly
    const monthlyText = headline.textContent!;
    const monthlyValue = parseFloat(monthlyText.replace(/[$,]/g, ''));
    expect(monthlyValue).toBeGreaterThan(5500);
    expect(monthlyValue).toBeLessThan(7000);
  });

  it('switches to bi-weekly when the period selector changes', async () => {
    const user = userEvent.setup();
    primeStores();
    render(
      <MemoryRouter>
        <PaycheckCard />
      </MemoryRouter>,
    );

    await user.selectOptions(screen.getByLabelText(/Period:/i), 'BI_WEEKLY');
    const headline = screen.getByTestId('paycheck-takehome');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    // Annual ~$73,100 / 26 ≈ $2,812
    expect(value).toBeGreaterThan(2500);
    expect(value).toBeLessThan(3100);
  });

  it('shows placeholder when no household is set', async () => {
    // Stores already reset — no household
    render(
      <MemoryRouter>
        <PaycheckCard />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Set up your household profile/i)).toBeInTheDocument();
  });
});
