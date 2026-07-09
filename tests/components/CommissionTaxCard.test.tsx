import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
 * Prime stores: CA SINGLE household, person with $100k salary, 5% 401k,
 * and $48k annual commission (MONTHLY).
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
        expectedCommission: 48000,
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
    sessionStorage.clear();
    resetStores();
  });

  it('renders monthly commission take-home for $48k/yr ($4k/month) in CA SINGLE', async () => {
    // Setup: CA SINGLE household; person $100k salary, 5% 401k.
    // Default frequency: MONTHLY (12/yr)
    // Annual commission $48k => per-check $4,000
    // Salary 401k = 5% of $100k = $5,000 (under $24,500 cap)
    // 401k from commission per check = $200 (5% of $4k, remaining cap = $19,500 > $2,400)
    // Tax on $48k commission (marginal at CA SINGLE ~$100k base): blended ~35-42%
    // Per check (12/yr): commission $4k - 401k $200 - tax ~$1,200 = ~$2,600 net
    primeStores();

    render(
      <MemoryRouter>
        <CommissionTaxCard />
      </MemoryRouter>,
    );

    const input = screen.getByLabelText(/Annual commission/i);
    fireEvent.change(input, { target: { value: '48000' } });

    const headline = await screen.findByTestId('commission-takehome');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(2000);
    expect(value).toBeLessThan(3500);
  });

  it('switching to QUARTERLY changes per-check amount', async () => {
    // Setup: same CA SINGLE, $100k salary, 5% 401k.
    // QUARTERLY (4/yr), $48k/yr annual = $12,000 per quarter
    // Salary 401k = $5,000; remaining cap = $19,500; commission 401k = 5% of $48k = $2,400
    // 401k per check = $600 (2,400/4)
    // Tax per check (annual ~$15k-19k) / 4 = ~$3,750-$4,750
    // Net per check = $12,000 - $600 - ~$4,200 = ~$7,200
    primeStores();

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CommissionTaxCard />
      </MemoryRouter>,
    );

    const input = screen.getByLabelText(/Annual commission/i);
    fireEvent.change(input, { target: { value: '48000' } });

    // Switch to QUARTERLY via the Radix combobox
    await user.click(screen.getByRole('combobox', { name: /frequency/i }));
    await user.click(await screen.findByRole('option', { name: /quarterly/i }));

    const headline = await screen.findByTestId('commission-takehome');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    // $48k/yr QUARTERLY => per-check net
    expect(value).toBeGreaterThan(6500);
    expect(value).toBeLessThan(10500);
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
          expectedCommission: 48000,
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

    render(<MemoryRouter><CommissionTaxCard /></MemoryRouter>);
    const input = screen.getByLabelText(/Annual commission/i);
    fireEvent.change(input, { target: { value: '48000' } });

    // Card renders with the stale 2025 rules — no crash, no empty state.
    const headline = await screen.findByTestId('commission-takehome');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(2000);
    expect(value).toBeLessThan(3500);
  });

  it('shows placeholder when commission is 0', async () => {
    primeStores();
    usePersonsStore.setState((s) => ({
      persons: s.persons.map((p) => ({ ...p, expectedCommission: 0 })),
    }));

    render(
      <MemoryRouter>
        <CommissionTaxCard />
      </MemoryRouter>,
    );

    // Default annualCommission = 0 → should show placeholder text
    expect(screen.getByText(/Enter a commission amount/i)).toBeInTheDocument();
  });

  it('Flat 22% mode persists the method and changes the federal figure', async () => {
    // Use a commission that straddles bracket boundaries so aggregate ≠ flat.
    // Override the person's commission expectation to 0 so we drive it via the input.
    primeStores();
    usePersonsStore.setState((s) => ({
      persons: s.persons.map((p) => ({ ...p, expectedCommission: 0 })),
    }));

    render(
      <MemoryRouter>
        <CommissionTaxCard />
      </MemoryRouter>,
    );

    const input = screen.getByLabelText(/Annual commission/i);
    // $200,000 commission: pushes into the 24% bracket while flat stays 22%
    fireEvent.change(input, { target: { value: '200000' } });

    // Wait until the card renders the populated (take-home) path
    await screen.findByTestId('commission-takehome');

    // Aggregate is the default — its button should be aria-pressed=true
    const aggregateBtn = screen.getByRole('button', { name: /aggregate/i });
    expect(aggregateBtn).toHaveAttribute('aria-pressed', 'true');

    // Record the aggregate per-check federal value before switching
    // Each ResultRow renders a label div followed by a value div in the same parent
    const aggregateFederalLabel = screen.getByText('Estimated federal tax');
    const aggregateFederalValue = aggregateFederalLabel.parentElement!.querySelector('.tabular-nums')!.textContent ?? '';

    // Click Flat 22%
    const flatBtn = screen.getByRole('button', { name: /flat/i });
    fireEvent.click(flatBtn);

    // sessionStorage must be persisted immediately
    expect(sessionStorage.getItem('calc-suppl-method:commission-tax')).toBe('FLAT');

    // The flat button should now be aria-pressed=true
    expect(flatBtn).toHaveAttribute('aria-pressed', 'true');
    // Aggregate button should now be aria-pressed=false
    expect(aggregateBtn).toHaveAttribute('aria-pressed', 'false');

    // Per-check federal in FLAT mode = 200000*0.22/12 = ~$3,666.67
    // Aggregate at $100k base pushes into 24% → federal will be higher → they differ
    const flatFederalValue = aggregateFederalLabel.parentElement!.querySelector('.tabular-nums')!.textContent ?? '';
    expect(flatFederalValue).not.toBe(aggregateFederalValue);
  });

  it('annual commission is the editable assumption; toggling frequency keeps it stable (rescale bug fixed)', async () => {
    primeStores(); // seeds a person with expectedCommission = 48000, MONTHLY
    const user = userEvent.setup();
    render(<MemoryRouter><CommissionTaxCard /></MemoryRouter>);

    const annual = await screen.findByLabelText(/Annual commission/i) as HTMLInputElement;
    expect(Number(annual.value)).toBe(48000);

    // Per-check derived for MONTHLY = 48000 / 12 = 4000.
    expect(screen.getAllByText(/\$4,000/).length).toBeGreaterThan(0);

    // Toggle to QUARTERLY via the Radix combobox: annual stays 48000, per-check re-derives to 12000.
    await user.click(screen.getByRole('combobox', { name: /frequency/i }));
    await user.click(await screen.findByRole('option', { name: /quarterly/i }));
    expect(Number((screen.getByLabelText(/Annual commission/i) as HTMLInputElement).value)).toBe(48000);
    expect(screen.getAllByText(/\$12,000/).length).toBeGreaterThan(0);
  });

  function primeDualEarnerMFJ() {
    // Two $150k earners, each deferring 10% into their own 401(k) ($15k each,
    // household $30k — legitimately above one $24,500 cap). Recipient is
    // persons[0] (expectedCommission $20k/yr, MONTHLY).
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
        {
          ...alice,
          id: 1,
          name: 'Alice',
          annualSalaryPretax: 150000,
          pretax401kPct: 0.10,
          expectedCommission: 20000,
          expectedCommissionFrequency: 'MONTHLY',
        },
        {
          ...alice,
          id: 2,
          name: 'Bob',
          annualSalaryPretax: 150000,
          pretax401kPct: 0.10,
          expectedCommission: 0,
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
          filingStatus: FilingStatus.MFJ,
          brackets: federalSingleBrackets,
          standardDeduction: 30000,
        },
        {
          id: 2,
          year: 2026,
          jurisdictionType: 'STATE',
          jurisdictionCode: 'CA',
          filingStatus: FilingStatus.MFJ,
          brackets: caSingleBrackets,
          standardDeduction: 0,
        },
      ],
      isLoading: false,
      error: null,
    });
  }

  it("commission 401(k) headroom is the RECIPIENT's, not the household aggregate (wave-9 F2)", async () => {
    // Household aggregate $30k > $24,500 → pre-fix remaining cap = $0 and the
    // commission deferral showed $0. The recipient personally defers $15k,
    // leaving $9,500 of room; a $20k commission at their 10% defers $2,000.
    const { formatCurrency } = await import('@/lib/format');
    primeDualEarnerMFJ();
    render(<MemoryRouter><CommissionTaxCard /></MemoryRouter>);
    await screen.findByTestId('commission-takehome');
    // $2,000/yr ÷ 12 → per-check figure:
    expect(screen.getByText(formatCurrency(2000 / 12))).toBeInTheDocument();
  });

  it("FICA on commission caps SS at the recipient's own wage base (wave-9 F1)", async () => {
    const { computeSupplementalWageTax, aggregateHouseholdPretax } = await import(
      '@/lib/calculators/supplemental-wage'
    );
    const { formatCurrency } = await import('@/lib/format');
    primeDualEarnerMFJ();
    render(<MemoryRouter><CommissionTaxCard /></MemoryRouter>);
    await screen.findByTestId('commission-takehome');

    const agg = aggregateHouseholdPretax(usePersonsStore.getState().persons, {
      filingStatus: FilingStatus.MFJ,
      personCount: 2,
      dependentCount: 0,
    });
    const common = {
      baseSalary: 300_000,
      supplementalWages: 20_000,
      pretax: agg.pretax,
      filingStatus: FilingStatus.MFJ,
      federalBrackets: federalSingleBrackets,
      stateBrackets: caSingleBrackets,
      cityBrackets: null,
      standardDeduction: { federal: 30000, state: 0, city: 0 },
    };
    const expected = computeSupplementalWageTax({
      ...common,
      perPersonBaseSalary: [150_000, 150_000],
      recipientIndex: 0,
    });
    const legacy = computeSupplementalWageTax(common);
    // Sanity: the fixture bites.
    expect(expected.bonusBreakdown.fica).toBeGreaterThan(legacy.bonusBreakdown.fica);
    // FICA renders per check (÷ 12 for MONTHLY).
    expect(screen.getByText(formatCurrency(expected.bonusBreakdown.fica / 12))).toBeInTheDocument();
  });

  // ── Round-3 T21 remainder: exact pins (chip task_0f86067f part 1) ─────────

  it("base fixture's commission 401(k) deferral pins at $200 per check (T21)", async () => {
    // primeStores: $100k salary at 5% → salary deferral $5,000; headroom
    // 24,500 − 5,000 = 19,500. Commission $48k at 5% = $2,400 ≤ headroom →
    // full $2,400/yr defers; MONTHLY → 2,400 / 12 = $200 per check. The :124
    // comment claimed this figure but nothing asserted it.
    const { formatCurrency } = await import('@/lib/format');
    primeStores();
    render(<MemoryRouter><CommissionTaxCard /></MemoryRouter>);
    await screen.findByTestId('commission-takehome');
    const row = screen.getByText('401(k) from this check').parentElement!;
    expect(row.querySelector('.tabular-nums')!.textContent).toBe(formatCurrency(2400 / 12));
  });

  it('cap-exhausted recipient defers $0 from the commission (T21)', async () => {
    // $245,000 salary at 10% = $24,500 — exactly the §402(g) cap, so the
    // commission headroom is zero and the per-check deferral must render $0.
    const { formatCurrency } = await import('@/lib/format');
    primeStores();
    usePersonsStore.setState((s) => ({
      persons: s.persons.map((p) => ({ ...p, annualSalaryPretax: 245000, pretax401kPct: 0.10 })),
    }));
    render(<MemoryRouter><CommissionTaxCard /></MemoryRouter>);
    await screen.findByTestId('commission-takehome');
    const row = screen.getByText('401(k) from this check').parentElement!;
    expect(row.querySelector('.tabular-nums')!.textContent).toBe(formatCurrency(0));
  });

  it('FLAT mode pins the exact per-check federal figure (T21)', async () => {
    // $200,000 commission, MONTHLY: flat federal = 200,000 × 22% / 12
    // = $3,666.67 per check (mirrors BonusTaxCard's exact-flat idiom).
    const { formatCurrency } = await import('@/lib/format');
    primeStores();
    usePersonsStore.setState((s) => ({
      persons: s.persons.map((p) => ({ ...p, expectedCommission: 0 })),
    }));
    render(<MemoryRouter><CommissionTaxCard /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Annual commission/i), { target: { value: '200000' } });
    await screen.findByTestId('commission-takehome');
    fireEvent.click(screen.getByRole('button', { name: /flat/i }));
    const row = screen.getByText('Estimated federal tax').parentElement!;
    expect(row.querySelector('.tabular-nums')!.textContent).toBe(formatCurrency((200_000 * 0.22) / 12));
  });

  it('discloses the mandatory 37% flat tier above $1M, drops dev jargon, and does not falsely disclaim Additional Medicare', () => {
    primeStores();
    render(<MemoryRouter><CommissionTaxCard /></MemoryRouter>);
    expect(screen.queryByText(/Additional Medicare/)).not.toBeInTheDocument();
    expect(screen.queryByText(/matches bonus card/)).not.toBeInTheDocument();
    expect(screen.getByText(/37%/, { exact: false })).toBeInTheDocument();
  });
});
