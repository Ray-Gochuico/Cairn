import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';
import { Retirement401kWithdrawalCard } from '@/pages/calculators/Retirement401kWithdrawalCard';

const federalSingleBrackets = [
  { min: 0,      max: 11_600,  rate: 0.10 },
  { min: 11_600, max: 47_150,  rate: 0.12 },
  { min: 47_150, max: 100_525, rate: 0.22 },
  { min: 100_525,max: 191_950, rate: 0.24 },
  { min: 191_950,max: 243_725, rate: 0.32 },
  { min: 243_725,max: null,    rate: 0.35 },
];

const caFlatBrackets = [{ min: 0, max: null, rate: 0.05 }];

function resetStores() {
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
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
        dateOfBirth: '1965-04-01',
        targetRetirementAge: 65,
        annualSalaryPretax: 120_000,
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
    year: 2026,
    items: [
      {
        id: 1,
        year: 2026,
        jurisdictionType: 'FEDERAL',
        jurisdictionCode: 'US',
        filingStatus: FilingStatus.SINGLE,
        brackets: federalSingleBrackets,
        standardDeduction: 14_600,
      },
      {
        id: 2,
        year: 2026,
        jurisdictionType: 'STATE',
        jurisdictionCode: 'CA',
        filingStatus: FilingStatus.SINGLE,
        brackets: caFlatBrackets,
        standardDeduction: 0,
      },
    ],
    isLoading: false,
    error: null,
  });
}

describe('Retirement401kWithdrawalCard', () => {
  beforeEach(() => {
    resetStores();
  });

  it('pre-fills the W-2 income default from the household persons sum', () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    const w2 = screen.getByLabelText(/annual w-2 income/i) as HTMLInputElement;
    expect(Number(w2.value)).toBe(120_000);
  });

  it('pre-fills the age default from persons[0].dateOfBirth', () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    const ageInput = screen.getByLabelText(/age at withdrawal/i) as HTMLInputElement;
    expect(Number(ageInput.value)).toBeGreaterThan(18);
  });

  it('renders a Roth toggle but it is disabled', () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    const rothToggle = screen.getByLabelText(/roth 401k/i) as HTMLInputElement;
    expect(rothToggle).toBeDisabled();
  });

  it('computes the 10% early-withdrawal penalty when the user is under 59.5', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );

    const ageInput = screen.getByLabelText(/age at withdrawal/i);
    fireEvent.change(ageInput, { target: { value: '45' } });

    const withdrawalInput = screen.getByLabelText(/withdrawal amount/i);
    fireEvent.change(withdrawalInput, { target: { value: '50000' } });

    // R7a: "Early-withdrawal penalty" is now wrapped in a TermTooltip so
    // findByText returns the inner span. Walk up to the flex row via closest.
    const penaltyLabel = await screen.findByText(/early-withdrawal penalty/i);
    const row = penaltyLabel.closest('.flex.justify-between') as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByText('$5,000')).toBeInTheDocument();
  });

  it('hides the penalty (shows $0) when age >= 59.5', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );

    const ageInput = screen.getByLabelText(/age at withdrawal/i);
    fireEvent.change(ageInput, { target: { value: '67' } });

    const withdrawalInput = screen.getByLabelText(/withdrawal amount/i);
    fireEvent.change(withdrawalInput, { target: { value: '50000' } });

    const penaltyLabel = await screen.findByText(/early-withdrawal penalty/i);
    const row = penaltyLabel.closest('.flex.justify-between') as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByText('$0')).toBeInTheDocument();
  });

  it('renders the "FICA — N/A on 401k withdrawals" notice once a breakdown is available', () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    expect(screen.getByText(/^fica$/i)).toBeInTheDocument();
    expect(screen.getByText(/n\/a on 401k/i)).toBeInTheDocument();
  });

  it('shows the effective rate row once the user enters a withdrawal', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );

    const ageInput = screen.getByLabelText(/age at withdrawal/i);
    fireEvent.change(ageInput, { target: { value: '67' } });
    const withdrawalInput = screen.getByLabelText(/withdrawal amount/i);
    fireEvent.change(withdrawalInput, { target: { value: '50000' } });

    expect(await screen.findByText(/effective rate/i)).toBeInTheDocument();
  });

  it('renders a placeholder when household is not set', () => {
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/set up your household profile/i),
    ).toBeInTheDocument();
  });

  it('surfaces "Estimated total taxes" and "Estimated net to you" as the two summary lines (Wave-3 Task 6 framing)', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/age at withdrawal/i), {
      target: { value: '67' },
    });
    fireEvent.change(screen.getByLabelText(/withdrawal amount/i), {
      target: { value: '50000' },
    });

    expect(await screen.findByText(/^estimated total taxes$/i)).toBeInTheDocument();
    expect(screen.getByText(/^estimated net to you$/i)).toBeInTheDocument();
    // Legacy ambiguous labels are gone.
    expect(screen.queryByText(/total tax on withdrawal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^net to user$/i)).not.toBeInTheDocument();
  });

  it('renders the two summary rows with equal-weight styling', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/age at withdrawal/i), {
      target: { value: '67' },
    });
    fireEvent.change(screen.getByLabelText(/withdrawal amount/i), {
      target: { value: '50000' },
    });

    const taxLabel = await screen.findByText(/^estimated total taxes$/i);
    const netLabel = screen.getByText(/^estimated net to you$/i);
    const taxRow = taxLabel.closest('[data-summary-row]') as HTMLElement;
    const netRow = netLabel.closest('[data-summary-row]') as HTMLElement;
    expect(taxRow).not.toBeNull();
    expect(netRow).not.toBeNull();
    // Equal visual weight: same className signature on both summary rows so
    // neither one reads as "the answer" and the other as a footnote.
    expect(taxRow.className).toBe(netRow.className);
  });

  it('exposes a "What this calculator does NOT model" disclosure (Wave-3 Task 6)', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/age at withdrawal/i), {
      target: { value: '67' },
    });
    fireEvent.change(screen.getByLabelText(/withdrawal amount/i), {
      target: { value: '50000' },
    });

    expect(await screen.findByText(/what this calculator does NOT model/i)).toBeInTheDocument();
    // The disclosure body covers the named omissions. (Wave-5 NEW-W5-2:
    // NIIT was removed from this list once the calculator started routing
    // through the incremental-tax path. NIIT delta now appears as its
    // own breakdown line — see Retirement401kWithdrawalCard.niit.test.tsx.)
    expect(screen.getByText(/AMT/)).toBeInTheDocument();
    expect(screen.getByText(/Rule of 55/i)).toBeInTheDocument();
    expect(screen.getByText(/SEPP/)).toBeInTheDocument();
    // RMD appears twice now (NIIT row TermTooltip + RMD disclosure bullet),
    // so use getAllByText for safety.
    expect(screen.getAllByText(/RMD/).length).toBeGreaterThanOrEqual(1);
  });

  it('uses Net-to-you as the card headline (not take-home of the full salary)', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/age at withdrawal/i), {
      target: { value: '67' },
    });
    fireEvent.change(screen.getByLabelText(/withdrawal amount/i), {
      target: { value: '50000' },
    });

    const headline = await screen.findByTestId('401k-withdrawal-net');
    const netRow = screen.getByText(/^estimated net to you$/i).closest('[data-summary-row]') as HTMLElement;
    // Headline value matches the Net-to-you line value so the meaning is
    // unambiguous: the big number is "what you keep", not "what tax you owe".
    expect(within(netRow).getByText(headline.textContent ?? '_MISMATCH_')).toBeInTheDocument();
  });
});
