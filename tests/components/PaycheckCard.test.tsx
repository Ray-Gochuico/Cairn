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
import { CONTRIBUTION_LIMITS_2026 } from '@/lib/contribution-limits';

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
        expectedCommission: 0,
        expectedCommissionFrequency: 'MONTHLY',
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

  it('the headline result region is a polite live region (W10 T8)', () => {
    primeStores();
    render(<MemoryRouter><PaycheckCard cardId="paycheck" onHide={() => {}} /></MemoryRouter>);
    const region = screen.getByTestId('paycheck-headline');
    expect(region).toHaveAttribute('role', 'status');
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

  it('still renders with stale (non-current) tax-rule year via getCurrentTaxYear fallback', async () => {
    // Seed household + person, but tax rules ONLY for 2025 (older than current
    // calendar year). The card's getCurrentTaxYear() resolver should pick 2025
    // as the most-recent seeded year and the lookup must still find the rules.
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
    useTaxRulesStore.setState({
      year: 2025,
      items: [
        {
          id: 1,
          year: 2025,
          jurisdictionType: 'FEDERAL',
          jurisdictionCode: 'US',
          filingStatus: FilingStatus.SINGLE,
          brackets: federalSingleBrackets,
          standardDeduction: 15000,
        },
        {
          id: 2,
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

    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);

    // Card renders the headline using the stale 2025 rules — no crash, no empty state.
    const headline = await screen.findByTestId('paycheck-takehome');
    const monthlyValue = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(monthlyValue).toBeGreaterThan(5500);
    expect(monthlyValue).toBeLessThan(7000);
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

  it('links to the full calculator page', async () => {
    primeStores();
    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);
    const link = await screen.findByRole('link', { name: /open full calculator/i });
    expect(link).toHaveAttribute('href', '/calculators/paycheck');
  });

  it('household FICA caps Social Security per earner (wave-9 F1)', async () => {
    // Dual $150k: SS = 2 × 150k × 6.2% = $18,600; Medicare 300k × 1.45% =
    // $4,350; AddMed MFJ over 250k = $450 → FICA $23,400. The combined-base
    // bug showed min(300k, 184.5k) × 6.2% + medicare = $16,239.
    const user = userEvent.setup();
    primeStores();
    useHouseholdStore.setState({
      household: {
        ...useHouseholdStore.getState().household!,
        filingStatus: FilingStatus.MFJ,
      },
      isLoading: false,
      error: null,
    });
    const alice = usePersonsStore.getState().persons[0];
    usePersonsStore.setState({
      persons: [
        { ...alice, id: 1, name: 'Alice', annualSalaryPretax: 150000, pretax401kPct: 0 },
        { ...alice, id: 2, name: 'Bob', annualSalaryPretax: 150000, pretax401kPct: 0 },
      ],
      isLoading: false,
      error: null,
    });
    const items = useTaxRulesStore.getState().items.map((i) => ({
      ...i,
      filingStatus: FilingStatus.MFJ,
    }));
    useTaxRulesStore.setState({ year: 2026, items, isLoading: false, error: null });

    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    // Annual period so the FICA row shows the yearly figure verbatim.
    await user.selectOptions(screen.getByLabelText(/Period:/i), 'ANNUAL');
    expect(screen.getByText('$23,400')).toBeInTheDocument();
    expect(screen.queryByText('$16,239')).not.toBeInTheDocument();
  });

  it('disclosure copy cites the live SS wage base, not the stale $168,600, and does not falsely disclaim Additional Medicare', async () => {
    primeStores();
    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    const wageBase = new RegExp(
      `\\$${CONTRIBUTION_LIMITS_2026.SOCIAL_SECURITY_WAGE_BASE.toLocaleString('en-US')}`,
    );
    expect(screen.getByText(wageBase, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/168,600/)).not.toBeInTheDocument();
    // Additional Medicare IS modeled (tax.ts) — it must not appear in the "not modeled" list.
    expect(screen.queryByText(/Additional Medicare/)).not.toBeInTheDocument();
  });
});
