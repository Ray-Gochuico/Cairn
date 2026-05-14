import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';
import { BonusTaxCard } from '@/pages/calculators/BonusTaxCard';

// Federal SINGLE brackets (2026 approximate)
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

function primeStores(expectedBonus = 10000) {
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
        expectedBonus,
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

describe('BonusTaxCard', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders bonus take-home headline using person + household + tax rules', async () => {
    // Setup: a single person earning $100k with $10k bonus, filing SINGLE, state CA
    // tax-rules-store pre-loaded with federal SINGLE + CA SINGLE
    // expected: marginal rate roughly 0.35-0.42 (federal 24% + CA 9.3% + FICA 7.65% = ~41%)
    // bonus take-home roughly $5,800-6,500

    primeStores(10000);

    render(
      <MemoryRouter>
        <BonusTaxCard />
      </MemoryRouter>,
    );

    await screen.findByText(/Bonus Tax/i);
    const headline = await screen.findByTestId('bonus-takehome');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(5500);
    expect(value).toBeLessThan(7000);
  });

  it('renders placeholder when household is not set', () => {
    // stores already reset — no household, no persons
    render(
      <MemoryRouter>
        <BonusTaxCard />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Set up your household profile/i)).toBeInTheDocument();
  });

  it('changing the override bonus amount updates the headline', async () => {
    const user = userEvent.setup();
    // Prime stores with $100k SINGLE CA + person with expectedBonus = $10k.
    primeStores(10000);
    render(<MemoryRouter><BonusTaxCard /></MemoryRouter>);
    await screen.findByTestId('bonus-takehome');

    // Click Override button to reveal the panel
    await user.click(screen.getByRole('button', { name: /override/i }));
    const input = screen.getByLabelText(/Bonus amount/i);
    // Use fireEvent.change for reliable controlled-input updates
    fireEvent.change(input, { target: { value: '20000' } });

    // Headline should now reflect $20k bonus instead of $10k — take-home should roughly double
    const headline = screen.getByTestId('bonus-takehome');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(11000);  // ~13k take-home on $20k bonus at ~35% marginal
  });

  it('shows placeholder when bonus override is set to 0', async () => {
    const user = userEvent.setup();
    // Prime stores with $10k expected bonus
    primeStores(10000);
    render(<MemoryRouter><BonusTaxCard /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /override/i }));
    const input = screen.getByLabelText(/Bonus amount/i);
    // Use fireEvent.change for reliable controlled-input updates
    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getByText(/Enter a bonus amount/i)).toBeInTheDocument();
  });

  it('headline body shows per-jurisdiction bonus tax breakdown', async () => {
    // Prime stores with standard setup
    primeStores(10000);
    render(<MemoryRouter><BonusTaxCard /></MemoryRouter>);
    await screen.findByTestId('bonus-takehome');
    expect(screen.getByText(/Federal on bonus/i)).toBeInTheDocument();
    expect(screen.getByText(/FICA on bonus/i)).toBeInTheDocument();
    expect(screen.getByText(/State on bonus/i)).toBeInTheDocument();
    expect(screen.getByText(/Marginal rate/i)).toBeInTheDocument();
  });
});
