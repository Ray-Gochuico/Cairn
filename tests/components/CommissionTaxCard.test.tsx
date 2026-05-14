import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';
import { CommissionTaxCard } from '@/pages/calculators/CommissionTaxCard';

// Federal SINGLE brackets (2026 approximate) — same as BonusTaxCard test fixture
const federalSingleBrackets = [
  { min: 0,       max: 11925,  rate: 0.10 },
  { min: 11925,   max: 48475,  rate: 0.12 },
  { min: 48475,   max: 103350, rate: 0.22 },
  { min: 103350,  max: 197300, rate: 0.24 },
  { min: 197300,  max: 250525, rate: 0.32 },
  { min: 250525,  max: 626350, rate: 0.35 },
  { min: 626350,  max: null,   rate: 0.37 },
];

// CA SINGLE brackets (2026 approximate) — same as BonusTaxCard test fixture
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

/**
 * Prime stores: CA SINGLE household, person with $100k salary and 5% 401k.
 */
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
        expectedCommission: 0,
        expectedCommissionFrequency: 'MONTHLY',
        pretax401kPct: 0.05,
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

describe('CommissionTaxCard', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders monthly commission take-home for $5k/month in CA SINGLE', async () => {
    // Setup: CA SINGLE household; person $100k salary, 5% 401k.
    // Default frequency: MONTHLY (12/yr)
    // Commission $5k/month => annual commission $60k
    // Salary 401k = 5% of $100k = $5,000 (under $24,500 cap)
    // 401k from commission per check = $250 (5% of $5k, remaining cap = $19,500 > $3,000)
    // Tax on $60k commission (marginal at CA SINGLE ~$100k base): ~35-42% blended = ~$22k-$25k
    // Per check (12/yr): commission $5k - 401k $250 - tax ~$1,900 = ~$2,850 net
    primeStores();

    render(
      <MemoryRouter>
        <CommissionTaxCard />
      </MemoryRouter>,
    );

    const input = screen.getByLabelText(/Commission per check/i);
    fireEvent.change(input, { target: { value: '5000' } });

    const headline = await screen.findByTestId('commission-takehome');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(2400);
    expect(value).toBeLessThan(3500);
  });

  it('switching to QUARTERLY changes per-check amount', async () => {
    // Setup: same CA SINGLE, $100k salary, 5% 401k.
    // QUARTERLY (4/yr), $15,000 per quarter = $60k/yr (same annual as above)
    // Salary 401k = $5,000; remaining cap = $19,500; commission 401k = 5% of $60k = $3,000
    // 401k per check = $750 (3,000/4)
    // Tax per check (annual ~$22k-25k) / 4 = ~$5,500-$6,250
    // Net per check = $15,000 - $750 - ~$5,700 = ~$8,550
    primeStores();

    render(
      <MemoryRouter>
        <CommissionTaxCard />
      </MemoryRouter>,
    );

    const input = screen.getByLabelText(/Commission per check/i);
    fireEvent.change(input, { target: { value: '15000' } });

    // Switch to QUARTERLY
    const select = screen.getByLabelText(/Frequency/i);
    fireEvent.change(select, { target: { value: 'QUARTERLY' } });

    const headline = await screen.findByTestId('commission-takehome');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    // $15k quarterly = same annual as $5k monthly but 4 checks/yr so roughly 3x per check
    expect(value).toBeGreaterThan(7200);
    expect(value).toBeLessThan(10500);
  });

  it('shows placeholder when commission is 0', async () => {
    primeStores();

    render(
      <MemoryRouter>
        <CommissionTaxCard />
      </MemoryRouter>,
    );

    // Default commissionPerCheck = 0 → should show placeholder text
    expect(screen.getByText(/Enter a commission amount/i)).toBeInTheDocument();
  });
});
