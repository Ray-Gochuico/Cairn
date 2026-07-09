import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('BonusTaxCard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStores();
  });

  it('renders bonus take-home headline using person + household + tax rules', async () => {
    // Setup: a single person earning $100k, filing SINGLE, state CA
    // bonus is entered via the inline input (no longer pulled from person)
    // tax-rules-store pre-loaded with federal SINGLE + CA SINGLE
    // expected: marginal rate roughly 0.35-0.42 (federal 24% + CA 9.3% + FICA 7.65% = ~41%)
    // bonus take-home roughly $5,800-6,500

    primeStores();

    render(
      <MemoryRouter>
        <BonusTaxCard />
      </MemoryRouter>,
    );

    // Wait for the card to render (bonus input is present)
    await screen.findByLabelText(/Bonus amount/i);

    // Type the bonus into the inline input
    const input = screen.getByLabelText(/Bonus amount/i);
    fireEvent.change(input, { target: { value: '10000' } });

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
    // Prime stores with $100k SINGLE CA. Bonus starts at 0 (no person default).
    primeStores();
    render(<MemoryRouter><BonusTaxCard /></MemoryRouter>);

    const input = screen.getByLabelText(/Bonus amount/i);
    // Set initial bonus to $10k, then change to $20k
    fireEvent.change(input, { target: { value: '10000' } });
    await screen.findByTestId('bonus-takehome');

    // Use fireEvent.change for reliable controlled-input updates
    fireEvent.change(input, { target: { value: '20000' } });

    // Headline should now reflect $20k bonus instead of $10k — take-home should roughly double
    const headline = screen.getByTestId('bonus-takehome');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(11000);  // ~13k take-home on $20k bonus at ~35% marginal
  });

  it('shows placeholder when bonus is 0', async () => {
    // Prime stores — bonus defaults to 0 (no person default)
    primeStores();
    render(<MemoryRouter><BonusTaxCard /></MemoryRouter>);
    // Default is 0, so placeholder should already be visible
    expect(screen.getByText(/Enter a bonus amount/i)).toBeInTheDocument();
  });

  it('headline body shows per-jurisdiction bonus tax breakdown', async () => {
    // Prime stores with standard setup; type $10k into the bonus input
    primeStores();
    render(<MemoryRouter><BonusTaxCard /></MemoryRouter>);
    const input = screen.getByLabelText(/Bonus amount/i);
    fireEvent.change(input, { target: { value: '10000' } });
    await screen.findByTestId('bonus-takehome');
    expect(screen.getByText(/Federal on bonus/i)).toBeInTheDocument();
    // FICA is wrapped in a TermTooltip (R7a glossary coverage), so the
    // div text becomes "FICA ⓘ on bonus" — split + an info-icon character.
    // Strip the ⓘ before matching.
    const matches = screen.queryAllByText(
      (_, el) => {
        if (!el) return false;
        const txt = (el.textContent ?? '')
          .replace(/[\u{2400}-\u{FFFD}]/gu, '') // strip glyphs incl. ⓘ
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim();
        return txt === 'fica on bonus';
      },
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getByText(/State on bonus/i)).toBeInTheDocument();
    // "Marginal rate" is also TermTooltip-wrapped; verify via textContent.
    const marginalMatches = screen.queryAllByText(
      (_, el) => {
        if (!el) return false;
        const txt = (el.textContent ?? '')
          .replace(/[\u{2400}-\u{FFFD}]/gu, '')
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim();
        return txt === 'marginal rate';
      },
    );
    expect(marginalMatches.length).toBeGreaterThan(0);
  });

  it('shows Quarterly frequency and adjusts annual bonus total', async () => {
    // Person seeded with expectedBonusFrequency=QUARTERLY. The input represents
    // a single quarterly bonus payment (e.g. $5000), and the math should treat
    // the annual figure as 5000 * 4 = 20000 when computing the bonus tax.
    primeStores();
    usePersonsStore.setState({
      persons: [
        {
          ...usePersonsStore.getState().persons[0],
          expectedBonus: 5000,
          expectedBonusFrequency: 'QUARTERLY',
          bonusIsConsistent: true,
        },
      ],
      isLoading: false,
      error: null,
    });

    render(<MemoryRouter><BonusTaxCard /></MemoryRouter>);

    // Frequency combobox trigger should show QUARTERLY seeded from the person
    const freqTrigger = await screen.findByRole('combobox', { name: /bonus frequency/i });
    expect(freqTrigger.textContent).toMatch(/quarterly/i);

    // Enter $5000 per quarter
    const input = screen.getByLabelText(/Bonus amount/i);
    fireEvent.change(input, { target: { value: '5000' } });
    await screen.findByTestId('bonus-takehome');

    // The annual figure (5000 * 4 = 20000) should be reflected somewhere in
    // the body so the user understands the math being applied.
    expect(screen.getByText(/\$20,000/)).toBeInTheDocument();

    // Per-bonus take-home should be roughly $5000 * (1 - ~0.41 marginal) ≈ $3000
    const headline = screen.getByTestId('bonus-takehome');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(2500);
    expect(value).toBeLessThan(3500);

    // With consistent=true, an annual rollup line should be visible.
    expect(screen.getByText(/total take-home/i)).toBeInTheDocument();
  });

  it('hides annual total line when bonus is not consistent', async () => {
    // Person seeded with bonusIsConsistent=false: the annual rollup line is
    // hidden because the user can't reliably project a full year of bonuses.
    primeStores();
    usePersonsStore.setState({
      persons: [
        {
          ...usePersonsStore.getState().persons[0],
          expectedBonus: 10000,
          expectedBonusFrequency: 'ANNUAL',
          bonusIsConsistent: false,
        },
      ],
      isLoading: false,
      error: null,
    });

    render(<MemoryRouter><BonusTaxCard /></MemoryRouter>);

    const input = screen.getByLabelText(/Bonus amount/i);
    fireEvent.change(input, { target: { value: '10000' } });
    await screen.findByTestId('bonus-takehome');

    // The "total take-home for the year" rollup must be absent.
    expect(screen.queryByText(/total take-home/i)).not.toBeInTheDocument();

    // The consistency checkbox should be unchecked, reflecting the seed.
    const consistencyCheckbox = screen.getByRole('checkbox', { name: /consistent/i });
    expect(consistencyCheckbox).not.toBeChecked();
  });

  it('still renders with stale (non-current) tax-rule year via getCurrentTaxYear fallback', async () => {
    // Seed household + person, but tax rules ONLY for 2025 (a year older than the
    // current calendar year). The card's getCurrentTaxYear() resolver should pick
    // 2025 as the most-recent seeded year and the lookup must still find the rules.
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

    render(<MemoryRouter><BonusTaxCard /></MemoryRouter>);
    const input = screen.getByLabelText(/Bonus amount/i);
    fireEvent.change(input, { target: { value: '10000' } });

    // Card renders the headline using the stale 2025 rules (no crash, no empty state).
    // The "stale year" warning is CalculatorsLayout's job (12.7.3), not the card's.
    const headline = await screen.findByTestId('bonus-takehome');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(5500);
    expect(value).toBeLessThan(7000);
  });

  it('toggling consistency override hides the annual rollup line', async () => {
    // Default seed is consistent=true; toggling the checkbox off should
    // hide the annual rollup line without persisting back to the store.
    primeStores();
    render(<MemoryRouter><BonusTaxCard /></MemoryRouter>);

    const input = screen.getByLabelText(/Bonus amount/i);
    fireEvent.change(input, { target: { value: '10000' } });
    await screen.findByTestId('bonus-takehome');

    // Default seed is consistent → annual rollup visible
    expect(screen.getByText(/total take-home/i)).toBeInTheDocument();

    // Toggle off
    const consistencyCheckbox = screen.getByRole('checkbox', { name: /consistent/i });
    fireEvent.click(consistencyCheckbox);

    expect(screen.queryByText(/total take-home/i)).not.toBeInTheDocument();
  });

  it('headline equals computeSupplementalWageTax wiring exactly (parity)', async () => {
    const { computeSupplementalWageTax } = await import('@/lib/calculators/supplemental-wage');
    const { formatCurrency } = await import('@/lib/format');
    primeStores();
    render(<MemoryRouter><BonusTaxCard /></MemoryRouter>);
    const input = screen.getByLabelText(/Bonus amount/i);
    fireEvent.change(input, { target: { value: '10000' } });
    const headline = await screen.findByTestId('bonus-takehome');

    const expected = computeSupplementalWageTax({
      baseSalary: 100000,
      supplementalWages: 10000,
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
      filingStatus: FilingStatus.SINGLE,
      federalBrackets: federalSingleBrackets,
      stateBrackets: caSingleBrackets,
      cityBrackets: null,
      standardDeduction: { federal: 15000, state: 0, city: 0 },
    });
    // ANNUAL frequency → bonusesPerYear = 1, so per-bonus take-home == annual.
    expect(headline.textContent).toBe(formatCurrency(expected.bonusTakeHome));
  });

  it('Reset to my data clears an override', async () => {
    primeStores();
    render(<MemoryRouter><BonusTaxCard /></MemoryRouter>);
    const input = screen.getByLabelText(/Bonus amount/i);
    fireEvent.change(input, { target: { value: '10000' } });
    await screen.findByTestId('bonus-takehome');
    fireEvent.click(screen.getByRole('button', { name: /reset to my data/i }));
    // Back to the $0 default → placeholder returns.
    expect(screen.getByText(/Enter a bonus amount/i)).toBeInTheDocument();
  });

  it('Flat 22% mode shows federal = flat withholding and persists the method', async () => {
    primeStores();
    render(<MemoryRouter><BonusTaxCard /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    await screen.findByTestId('bonus-takehome');
    fireEvent.click(screen.getByRole('button', { name: /flat/i }));
    // flat 22% on $10k = $2,200 federal
    expect(screen.getByText(/\$2,200/)).toBeInTheDocument();
    expect(sessionStorage.getItem('calc-suppl-method:bonus-tax')).toBe('FLAT');
  });

  it('defaults to Aggregate (toggle pressed) so existing math is unchanged', async () => {
    primeStores();
    render(<MemoryRouter><BonusTaxCard /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    await screen.findByTestId('bonus-takehome');
    expect(screen.getByRole('button', { name: /aggregate/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it("FICA on bonus uses the RECIPIENT's own SS wage base, not the combined household gross (wave-9 F1)", async () => {
    // Two $150k earners (combined $300k > $184,500); $30k bonus to earner 0,
    // who is personally under the wage base → SS must appear on the bonus.
    // Pre-fix the combined base swallowed it (FICA-on-bonus row showed only
    // the Medicare legs).
    const { computeSupplementalWageTax } = await import('@/lib/calculators/supplemental-wage');
    const { formatCurrency } = await import('@/lib/format');
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
        { ...alice, id: 1, name: 'Alice', annualSalaryPretax: 150000, expectedBonus: 30000 },
        { ...alice, id: 2, name: 'Bob', annualSalaryPretax: 150000, expectedBonus: 0 },
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

    render(<MemoryRouter><BonusTaxCard /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '30000' } });
    await screen.findByTestId('bonus-takehome');

    const common = {
      baseSalary: 300_000,
      supplementalWages: 30_000,
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
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
    // Sanity: the fixture bites (per-earner SS actually differs).
    expect(expected.bonusBreakdown.fica).toBeGreaterThan(legacy.bonusBreakdown.fica);
    expect(screen.getByText(formatCurrency(expected.bonusBreakdown.fica))).toBeInTheDocument();
  });
});
