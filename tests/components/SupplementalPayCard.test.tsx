/**
 * Wave 18 B7 — SupplementalPayCard (Bonus + Commission merged).
 *
 * Ports EVERY old Bonus-card suite case (Bonus segment) and EVERY
 * old Commission-card suite case (Commission segment), each preceded by
 * clicking the type segment. Documented adaptations (plan Task 7 Step 1):
 *   - isConsistent checkbox → the D15 annual-echo line (always renders when
 *     amount > 0, conditional framing).
 *   - Commission input is PER-EVENT (D15): expectedCommission ÷ periods
 *     prefill; expected figures recomputed via the per-event → annual round
 *     trip (same engine outputs).
 *   - D1: the emphasis take-home row = gross − tax (NOT minus the 401(k)
 *     deferral); the deferral becomes an explicit annual routing line +
 *     honesty sentence.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';
import { SupplementalPayCard } from '@/pages/calculators/SupplementalPayCard';

// Federal SINGLE brackets (2026 approximate) — same as the old suites.
const federalSingleBrackets = [
  { min: 0,       max: 11925,  rate: 0.10 },
  { min: 11925,   max: 48475,  rate: 0.12 },
  { min: 48475,   max: 103350, rate: 0.22 },
  { min: 103350,  max: 197300, rate: 0.24 },
  { min: 197300,  max: 250525, rate: 0.32 },
  { min: 250525,  max: 626350, rate: 0.35 },
  { min: 626350,  max: null,   rate: 0.37 },
];

// CA SINGLE brackets (2026 approximate) — same as the old suites.
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

/** CA SINGLE household; Alice $100k salary, no pretax, no expected amounts. */
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

/** CA SINGLE household; Alice $100k, 5% 401(k), $48k annual commission MONTHLY. */
function primeCommissionStores() {
  primeStores();
  usePersonsStore.setState((s) => ({
    ...s,
    persons: s.persons.map((p) => ({
      ...p,
      expectedCommission: 48000,
      expectedCommissionFrequency: 'MONTHLY' as const,
      pretax401kPct: 0.05,
    })),
  }));
}

function renderCard(cardId?: string) {
  return render(
    <MemoryRouter>
      <SupplementalPayCard cardId={cardId} />
    </MemoryRouter>,
  );
}

async function toCommission() {
  fireEvent.click(await screen.findByRole('button', { name: 'Commission' }));
}

/** textContent matcher tolerant of TermTooltip ⓘ glyphs and nested spans. */
function byNormalizedText(expected: string) {
  return (_: string, el: Element | null) => {
    if (!el) return false;
    const txt = (el.textContent ?? '')
      .replace(/[\u{2400}-\u{FFFD}]/gu, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    return txt === expected;
  };
}

describe('SupplementalPayCard — shell', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStores();
  });

  it('defaults to the Bonus segment; segment persists under calc-suppl-type:supplemental-pay', async () => {
    primeStores();
    renderCard();
    expect(screen.getByRole('button', { name: 'Bonus' })).toHaveAttribute('aria-pressed', 'true');
    await toCommission();
    expect(screen.getByRole('button', { name: 'Commission' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(sessionStorage.getItem('calc-suppl-type:supplemental-pay')).toBe('COMMISSION');
  });

  it('per-segment state isolation (D12): a bonus edit survives a segment round-trip; commission untouched', async () => {
    primeStores();
    renderCard();
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    expect(
      JSON.parse(sessionStorage.getItem('calc-state:bonus-tax')!).bonus,
    ).toBe(10000);
    await toCommission();
    // Commission's own state is untouched by the bonus edit.
    expect(sessionStorage.getItem('calc-state:commission-tax')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Bonus' }));
    expect((screen.getByLabelText(/Bonus amount/i) as HTMLInputElement).value).toBe('10000');
  });

  it('no consistency checkbox renders (D15 — the echo line replaced it)', async () => {
    primeStores();
    renderCard();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

describe('SupplementalPayCard — Bonus segment', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStores();
  });

  it('renders bonus take-home headline using person + household + tax rules', async () => {
    primeStores();
    renderCard();
    await screen.findByLabelText(/Bonus amount/i);
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    const headline = await screen.findByTestId('supplemental-headline');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(5500);
    expect(value).toBeLessThan(7000);
  });

  it('renders placeholder when household is not set', () => {
    renderCard();
    expect(screen.getByText(/Set up your household profile/i)).toBeInTheDocument();
  });

  it('empty-state CTA links to the destination it names (Wave 15 T10)', () => {
    renderCard();
    expect(
      screen.getByRole('link', { name: /set up your household profile/i }),
    ).toHaveAttribute('href', '/inputs/household');
  });

  it('changing the override bonus amount updates the headline', async () => {
    primeStores();
    renderCard();
    const input = screen.getByLabelText(/Bonus amount/i);
    fireEvent.change(input, { target: { value: '10000' } });
    await screen.findByTestId('supplemental-headline');
    fireEvent.change(input, { target: { value: '20000' } });
    const headline = screen.getByTestId('supplemental-headline');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(11000);
  });

  it('shows placeholder when bonus is 0', async () => {
    primeStores();
    renderCard();
    expect(screen.getByText(/Enter a bonus amount/i)).toBeInTheDocument();
  });

  it('body shows per-jurisdiction bonus tax breakdown', async () => {
    primeStores();
    renderCard();
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    await screen.findByTestId('supplemental-headline');
    expect(screen.getByText(/Federal on bonus/i)).toBeInTheDocument();
    expect(screen.queryAllByText(byNormalizedText('fica on bonus')).length).toBeGreaterThan(0);
    expect(screen.getByText(/State on bonus/i)).toBeInTheDocument();
    expect(screen.queryAllByText(byNormalizedText('marginal rate')).length).toBeGreaterThan(0);
  });

  it('shows Quarterly frequency and computes on the annualized total', async () => {
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
    renderCard();
    const freqTrigger = await screen.findByRole('combobox', { name: /bonus frequency/i });
    expect(freqTrigger.textContent).toMatch(/quarterly/i);
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '5000' } });
    await screen.findByTestId('supplemental-headline');
    // Per-bonus take-home ≈ $5000 × (1 − ~0.41 marginal on the $20k annual).
    const headline = screen.getByTestId('supplemental-headline');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(2500);
    expect(value).toBeLessThan(3500);
    // D15: the annual echo carries the rollup (4 × per-event take-home).
    const echo = screen.getByTestId('supplemental-annual-echo');
    expect(echo.textContent).toMatch(/If this repeats: .+\/yr take-home/);
    expect(echo.textContent).toContain('4 ×');
  });

  it('annual echo line ALWAYS renders when amount > 0 (D15 — replaces the isConsistent gate)', async () => {
    primeStores();
    renderCard();
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    await screen.findByTestId('supplemental-headline');
    expect(screen.getByTestId('supplemental-annual-echo').textContent).toMatch(
      /If this repeats: .+\/yr take-home/,
    );
  });

  it('still renders with stale (non-current) tax-rule year via getCurrentTaxYear fallback', async () => {
    primeStores();
    // Re-seed rules under 2025 only.
    useTaxRulesStore.setState({
      year: 2025,
      items: useTaxRulesStore.getState().items.map((i) => ({ ...i, year: 2025 })),
      isLoading: false,
      error: null,
    });
    renderCard();
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    const headline = await screen.findByTestId('supplemental-headline');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(5500);
    expect(value).toBeLessThan(7000);
  });

  it('headline equals computeSupplementalWageTax wiring exactly (parity)', async () => {
    const { computeSupplementalWageTax } = await import('@/lib/calculators/supplemental-wage');
    const { formatCurrency } = await import('@/lib/format');
    primeStores();
    renderCard();
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    const headline = await screen.findByTestId('supplemental-headline');
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
    expect(headline.textContent).toBe(formatCurrency(expected.bonusTakeHome));
  });

  it('Reset to my data clears an override', async () => {
    primeStores();
    renderCard();
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    await screen.findByTestId('supplemental-headline');
    fireEvent.click(screen.getByRole('button', { name: /reset to my data/i }));
    expect(screen.getByText(/Enter a bonus amount/i)).toBeInTheDocument();
  });

  it('Flat 22% mode shows federal = flat withholding and persists the method under the PRESERVED key', async () => {
    primeStores();
    renderCard();
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    await screen.findByTestId('supplemental-headline');
    fireEvent.click(screen.getByRole('button', { name: /flat/i }));
    expect(screen.getByText(/\$2,200/)).toBeInTheDocument();
    expect(sessionStorage.getItem('calc-suppl-method:bonus-tax')).toBe('FLAT');
  });

  it('FLAT headline equals flat withholding + the engine FICA/state legs exactly (round-3 T21)', async () => {
    const { computeSupplementalWageTax, flatSupplementalWithholding } = await import(
      '@/lib/calculators/supplemental-wage'
    );
    const { formatCurrency } = await import('@/lib/format');
    primeStores();
    renderCard();
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    const headline = await screen.findByTestId('supplemental-headline');
    fireEvent.click(screen.getByRole('button', { name: /flat/i }));
    const engine = computeSupplementalWageTax({
      baseSalary: 100000,
      supplementalWages: 10000,
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
      filingStatus: FilingStatus.SINGLE,
      federalBrackets: federalSingleBrackets,
      stateBrackets: caSingleBrackets,
      cityBrackets: null,
      standardDeduction: { federal: 15000, state: 0, city: 0 },
    });
    const expected =
      10000 -
      (flatSupplementalWithholding(10000) +
        engine.bonusBreakdown.fica +
        engine.bonusBreakdown.state +
        engine.bonusBreakdown.city);
    expect(headline.textContent).toBe(formatCurrency(expected));
  });

  it('defaults to Aggregate (toggle pressed) so existing math is unchanged', async () => {
    primeStores();
    renderCard();
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    await screen.findByTestId('supplemental-headline');
    expect(screen.getByRole('button', { name: /aggregate/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it("FICA on bonus uses the RECIPIENT's own SS wage base, not the combined household gross (wave-9 F1)", async () => {
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
          id: 1, year: 2026, jurisdictionType: 'FEDERAL', jurisdictionCode: 'US',
          filingStatus: FilingStatus.MFJ, brackets: federalSingleBrackets, standardDeduction: 30000,
        },
        {
          id: 2, year: 2026, jurisdictionType: 'STATE', jurisdictionCode: 'CA',
          filingStatus: FilingStatus.MFJ, brackets: caSingleBrackets, standardDeduction: 0,
        },
      ],
      isLoading: false,
      error: null,
    });

    renderCard();
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '30000' } });
    await screen.findByTestId('supplemental-headline');

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
    expect(expected.bonusBreakdown.fica).toBeGreaterThan(legacy.bonusBreakdown.fica);
    expect(screen.getByText(formatCurrency(expected.bonusBreakdown.fica))).toBeInTheDocument();
  });

  it('EarnerSelect renders only with 2+ persons; switching earner re-prefills and re-attributes (Wave 18)', async () => {
    const { computeSupplementalWageTax } = await import('@/lib/calculators/supplemental-wage');
    const { formatCurrency } = await import('@/lib/format');
    const user = userEvent.setup();
    primeStores();
    // Single person → no picker.
    renderCard();
    expect(screen.queryByRole('group', { name: /who receives this bonus/i })).not.toBeInTheDocument();

    // Two MFJ earners; Alice over the SS wage base, Bob under — switching the
    // recipient changes the marginal FICA on the same $10k bonus.
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
        { ...alice, id: 1, name: 'Alice', annualSalaryPretax: 200000, expectedBonus: 10000 },
        { ...alice, id: 2, name: 'Bob', annualSalaryPretax: 50000, expectedBonus: 4000 },
      ],
      isLoading: false,
      error: null,
    });
    useTaxRulesStore.setState({
      year: 2026,
      items: [
        {
          id: 1, year: 2026, jurisdictionType: 'FEDERAL', jurisdictionCode: 'US',
          filingStatus: FilingStatus.MFJ, brackets: federalSingleBrackets, standardDeduction: 30000,
        },
        {
          id: 2, year: 2026, jurisdictionType: 'STATE', jurisdictionCode: 'CA',
          filingStatus: FilingStatus.MFJ, brackets: caSingleBrackets, standardDeduction: 0,
        },
      ],
      isLoading: false,
      error: null,
    });

    // Default earner = Alice (has the larger expectedBonus? No — the FIRST
    // person with a bonus). Prefill = Alice's $10,000.
    const input = (await screen.findByLabelText(/Bonus amount/i)) as HTMLInputElement;
    expect(Number(input.value)).toBe(10000);

    const group = screen.getByRole('group', { name: /who receives this bonus/i });
    await user.click(within(group).getByRole('button', { name: 'Bob' }));
    // Prefill re-derives from Bob's expectedBonus.
    expect(Number((screen.getByLabelText(/Bonus amount/i) as HTMLInputElement).value)).toBe(4000);

    // recipientIndex re-attributes: Bob is under the wage base, so his $4k
    // bonus carries full SS — assert the exact engine figure renders.
    const bobResult = computeSupplementalWageTax({
      baseSalary: 250_000,
      supplementalWages: 4_000,
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
      filingStatus: FilingStatus.MFJ,
      federalBrackets: federalSingleBrackets,
      stateBrackets: caSingleBrackets,
      cityBrackets: null,
      standardDeduction: { federal: 30000, state: 0, city: 0 },
      perPersonBaseSalary: [200_000, 50_000],
      recipientIndex: 1,
    });
    expect(screen.getByText(formatCurrency(bobResult.bonusBreakdown.fica))).toBeInTheDocument();
  });

  it('prefills the bonus input from the recipient person expectedBonus (ANNUAL)', async () => {
    primeStores();
    usePersonsStore.setState((s) => ({
      ...s,
      persons: s.persons.map((p) => ({ ...p, expectedBonus: 10000, expectedBonusFrequency: 'ANNUAL' as const })),
    }));
    renderCard();
    const input = (await screen.findByLabelText(/Bonus amount/i)) as HTMLInputElement;
    expect(Number(input.value)).toBe(10000);
    expect(await screen.findByTestId('supplemental-headline')).toBeInTheDocument();
  });

  it('QUARTERLY expectedBonus prefills the PER-QUARTER amount (annual ÷ 4)', async () => {
    primeStores();
    usePersonsStore.setState((s) => ({
      ...s,
      persons: s.persons.map((p) => ({ ...p, expectedBonus: 12000, expectedBonusFrequency: 'QUARTERLY' as const })),
    }));
    renderCard();
    const input = (await screen.findByLabelText(/Bonus amount \(per quarter\)/i)) as HTMLInputElement;
    expect(Number(input.value)).toBe(3000);
  });

  it('FLAT method relabels the rate row "effective withholding rate" (it is NOT a marginal rate)', async () => {
    primeStores();
    renderCard();
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    await screen.findByTestId('supplemental-headline');
    fireEvent.click(screen.getByRole('button', { name: /flat/i }));
    expect(screen.getByText(/effective withholding rate/i)).toBeInTheDocument();
    expect(screen.queryAllByText(byNormalizedText('marginal rate')).length).toBe(0);
  });

  it('results grid carries an emphasized take-home row', async () => {
    primeStores();
    renderCard();
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    await screen.findByTestId('supplemental-headline');
    expect(screen.getByText(/Estimated bonus take-home/i)).toBeInTheDocument();
  });

  it('does not falsely claim Additional Medicare is unmodeled (it IS modeled)', async () => {
    primeStores();
    renderCard();
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    expect(screen.queryByText(/Additional Medicare/)).not.toBeInTheDocument();
  });

  it('bonus-only disclosure bullets render; commission-only bullets do not', async () => {
    primeStores();
    renderCard();
    fireEvent.change(screen.getByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    await screen.findByTestId('supplemental-headline');
    // Bonus-only: RSU vesting, bonus-period catch-up, ISO disqualifying disposition.
    expect(screen.getByText(/RSU vesting taxes/i)).toBeInTheDocument();
    expect(screen.getByText(/Bonus-period 401\(k\) catch-up elections/i)).toBeInTheDocument();
    expect(screen.getByText(/disqualifying disposition/i)).toBeInTheDocument();
    // Shared: state supplemental flat rates.
    expect(screen.getByText(/State-specific supplemental-wage flat rates/i)).toBeInTheDocument();
    // Commission-only bullets absent under Bonus.
    expect(screen.queryByText(/Clawback/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Self-employment tax/i)).not.toBeInTheDocument();
  });
});

describe('SupplementalPayCard — Commission segment', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStores();
  });

  it('empty-state CTA links to the destination it names (Wave 15 T10)', async () => {
    renderCard();
    await toCommission();
    expect(
      screen.getByRole('link', { name: /set up your household profile/i }),
    ).toHaveAttribute('href', '/inputs/household');
  });

  it('renders monthly commission take-home for $4k/check in CA SINGLE (D1: gross − tax)', async () => {
    primeCommissionStores();
    renderCard();
    await toCommission();
    // Prefill = expectedCommission ÷ 12 = $4,000/check (D15 per-event).
    const input = (await screen.findByLabelText(/Commission per check/i)) as HTMLInputElement;
    expect(Number(input.value)).toBe(4000);
    const headline = await screen.findByTestId('supplemental-headline');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    // D1: take-home = gross − tax (no deferral subtraction) — slightly above
    // the old net-minus-deferral figure, same band.
    expect(value).toBeGreaterThan(2000);
    expect(value).toBeLessThan(3500);
  });

  it('take-home row equals gross − tax exactly — the deferral is NOT subtracted (D1)', async () => {
    const { computeSupplementalWageTax, aggregateHouseholdPretax } = await import(
      '@/lib/calculators/supplemental-wage'
    );
    const { formatCurrency } = await import('@/lib/format');
    primeCommissionStores();
    renderCard();
    await toCommission();
    const headline = await screen.findByTestId('supplemental-headline');

    const agg = aggregateHouseholdPretax(usePersonsStore.getState().persons, {
      filingStatus: FilingStatus.SINGLE,
      personCount: 1,
      dependentCount: 0,
    });
    const engine = computeSupplementalWageTax({
      baseSalary: 100_000,
      supplementalWages: 48_000,
      pretax: agg.pretax,
      filingStatus: FilingStatus.SINGLE,
      federalBrackets: federalSingleBrackets,
      stateBrackets: caSingleBrackets,
      cityBrackets: null,
      standardDeduction: { federal: 15000, state: 0, city: 0 },
      perPersonBaseSalary: [100_000],
      recipientIndex: 0,
    });
    // Per-check take-home = (annual gross − annual tax) ÷ 12 — deferral NOT in the pipeline.
    expect(headline.textContent).toBe(
      formatCurrency((48_000 - engine.bonusBreakdown.total) / 12),
    );
    // The old subtracted figure must NOT be the emphasis value.
    expect(headline.textContent).not.toBe(
      formatCurrency((48_000 - 2_400 - engine.bonusBreakdown.total) / 12),
    );
  });

  it('deferral routing rows: annual 401(k) figure + cap context + cash in pocket + honesty sentence (D1)', async () => {
    const { formatCurrency } = await import('@/lib/format');
    primeCommissionStores();
    renderCard();
    await toCommission();
    await screen.findByTestId('supplemental-headline');
    // $100k at 5% → own deferral $5,000; headroom 19,500; commission $48k at
    // 5% → $2,400 defers; cap remaining after = $17,100.
    const routing = screen.getByText('401(k) from this commission (annual)').parentElement!;
    expect(routing.textContent).toContain(formatCurrency(2400));
    expect(routing.textContent).toMatch(/of your \$24,500 cap remains/);
    expect(routing.textContent).toContain(formatCurrency(17_100));
    expect(screen.getByText('Cash in pocket after deferral (annual)')).toBeInTheDocument();
    expect(
      screen.getByText(/The deferral's income-tax savings aren't modeled here/i),
    ).toBeInTheDocument();
  });

  it('cap-exhausted recipient: no deferral routing rows render (T21 adapted)', async () => {
    primeCommissionStores();
    usePersonsStore.setState((s) => ({
      ...s,
      persons: s.persons.map((p) => ({ ...p, annualSalaryPretax: 245000, pretax401kPct: 0.10 })),
    }));
    renderCard();
    await toCommission();
    await screen.findByTestId('supplemental-headline');
    expect(screen.queryByText('401(k) from this commission (annual)')).not.toBeInTheDocument();
  });

  it('switching to QUARTERLY keeps the per-event amount; the annual re-derives (D15)', async () => {
    const { computeSupplementalWageTax, aggregateHouseholdPretax } = await import(
      '@/lib/calculators/supplemental-wage'
    );
    const { formatCurrency } = await import('@/lib/format');
    primeCommissionStores();
    const user = userEvent.setup();
    renderCard();
    await toCommission();
    const input = (await screen.findByLabelText(/Commission per check/i)) as HTMLInputElement;
    expect(Number(input.value)).toBe(4000);

    await user.click(screen.getByRole('combobox', { name: /frequency/i }));
    await user.click(await screen.findByRole('option', { name: /quarterly/i }));

    // Per-event input value survives; annual = 4,000 × 4 = 16,000 now.
    expect(Number((screen.getByLabelText(/Commission per check/i) as HTMLInputElement).value)).toBe(4000);
    const agg = aggregateHouseholdPretax(usePersonsStore.getState().persons, {
      filingStatus: FilingStatus.SINGLE,
      personCount: 1,
      dependentCount: 0,
    });
    const engine = computeSupplementalWageTax({
      baseSalary: 100_000,
      supplementalWages: 16_000,
      pretax: agg.pretax,
      filingStatus: FilingStatus.SINGLE,
      federalBrackets: federalSingleBrackets,
      stateBrackets: caSingleBrackets,
      cityBrackets: null,
      standardDeduction: { federal: 15000, state: 0, city: 0 },
      perPersonBaseSalary: [100_000],
      recipientIndex: 0,
    });
    expect(screen.getByTestId('supplemental-headline').textContent).toBe(
      formatCurrency((16_000 - engine.bonusBreakdown.total) / 4),
    );
  });

  it('still renders with stale (non-current) tax-rule year via getCurrentTaxYear fallback', async () => {
    primeCommissionStores();
    useTaxRulesStore.setState({
      year: 2025,
      items: useTaxRulesStore.getState().items.map((i) => ({ ...i, year: 2025 })),
      isLoading: false,
      error: null,
    });
    renderCard();
    await toCommission();
    const headline = await screen.findByTestId('supplemental-headline');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(2000);
    expect(value).toBeLessThan(3500);
  });

  it('shows placeholder when commission is 0', async () => {
    primeStores(); // expectedCommission 0
    renderCard();
    await toCommission();
    expect(screen.getByText(/Enter a commission amount/i)).toBeInTheDocument();
  });

  it('Flat 22% mode persists the method under the PRESERVED key and changes the federal figure', async () => {
    primeStores();
    renderCard();
    await toCommission();
    const input = screen.getByLabelText(/Commission per check/i);
    // $20,000/check MONTHLY = $240k annual: aggregate ≠ flat.
    fireEvent.change(input, { target: { value: '20000' } });
    await screen.findByTestId('supplemental-headline');

    const aggregateBtn = screen.getByRole('button', { name: /aggregate/i });
    expect(aggregateBtn).toHaveAttribute('aria-pressed', 'true');
    const federalLabel = screen.getByText(/Estimated federal on commission/i);
    const aggregateFederalValue =
      federalLabel.parentElement!.querySelector('.tabular-nums')!.textContent ?? '';

    const flatBtn = screen.getByRole('button', { name: /flat/i });
    fireEvent.click(flatBtn);
    expect(sessionStorage.getItem('calc-suppl-method:commission-tax')).toBe('FLAT');
    expect(flatBtn).toHaveAttribute('aria-pressed', 'true');
    expect(aggregateBtn).toHaveAttribute('aria-pressed', 'false');
    const flatFederalValue =
      federalLabel.parentElement!.querySelector('.tabular-nums')!.textContent ?? '';
    expect(flatFederalValue).not.toBe(aggregateFederalValue);
  });

  it('FLAT mode pins the exact per-check federal figure (T21 adapted to per-event input)', async () => {
    // $20,000/check MONTHLY → annual $240,000; flat federal = 240,000 × 22%
    // = $52,800/yr → $4,400 per check.
    const { formatCurrency } = await import('@/lib/format');
    primeStores();
    renderCard();
    await toCommission();
    fireEvent.change(screen.getByLabelText(/Commission per check/i), { target: { value: '20000' } });
    await screen.findByTestId('supplemental-headline');
    fireEvent.click(screen.getByRole('button', { name: /flat/i }));
    const row = screen.getByText(/Estimated federal on commission/i).parentElement!;
    expect(row.querySelector('.tabular-nums')!.textContent).toBe(formatCurrency(4400));
  });

  it("FICA on commission caps SS at the recipient's own wage base (wave-9 F1)", async () => {
    const { computeSupplementalWageTax, aggregateHouseholdPretax } = await import(
      '@/lib/calculators/supplemental-wage'
    );
    const { formatCurrency } = await import('@/lib/format');
    // Dual $150k MFJ, each 10% 401(k); Alice has $20k/yr commission MONTHLY.
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
          ...alice, id: 1, name: 'Alice', annualSalaryPretax: 150000,
          pretax401kPct: 0.10, expectedCommission: 20000, expectedCommissionFrequency: 'MONTHLY',
        },
        { ...alice, id: 2, name: 'Bob', annualSalaryPretax: 150000, pretax401kPct: 0.10, expectedCommission: 0 },
      ],
      isLoading: false,
      error: null,
    });
    useTaxRulesStore.setState({
      year: 2026,
      items: [
        {
          id: 1, year: 2026, jurisdictionType: 'FEDERAL', jurisdictionCode: 'US',
          filingStatus: FilingStatus.MFJ, brackets: federalSingleBrackets, standardDeduction: 30000,
        },
        {
          id: 2, year: 2026, jurisdictionType: 'STATE', jurisdictionCode: 'CA',
          filingStatus: FilingStatus.MFJ, brackets: caSingleBrackets, standardDeduction: 0,
        },
      ],
      isLoading: false,
      error: null,
    });
    renderCard();
    await toCommission();
    await screen.findByTestId('supplemental-headline');

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
    expect(expected.bonusBreakdown.fica).toBeGreaterThan(legacy.bonusBreakdown.fica);
    // FICA renders per check (÷ 12 for MONTHLY).
    expect(screen.getByText(formatCurrency(expected.bonusBreakdown.fica / 12))).toBeInTheDocument();
    // D1 routing (dual-earner naming): recipient's own headroom — $2,000
    // defers, $7,500 of Alice's cap remains.
    const routing = screen.getByText('401(k) from this commission (annual)').parentElement!;
    expect(routing.textContent).toContain(formatCurrency(2000));
    expect(routing.textContent).toMatch(/of Alice's \$24,500 cap remains/);
  });

  it('seeds the commission default from the RECIPIENT (first person WITH commission), not persons[0]', async () => {
    primeStores();
    const alice = usePersonsStore.getState().persons[0];
    usePersonsStore.setState({
      persons: [
        { ...alice, id: 1, name: 'Alice', expectedCommission: 0 },
        { ...alice, id: 2, name: 'Bob', expectedCommission: 36000, expectedCommissionFrequency: 'QUARTERLY' as const },
      ],
      isLoading: false,
      error: null,
    });
    renderCard();
    await toCommission();
    // Recipient = Bob; QUARTERLY ⇒ per-event prefill = 36,000 ÷ 4 = 9,000.
    const input = (await screen.findByLabelText(/Commission per check/i)) as HTMLInputElement;
    expect(Number(input.value)).toBe(9000);
    const freqTrigger = screen.getByRole('combobox', { name: /frequency/i });
    expect(freqTrigger.textContent).toMatch(/quarterly/i);
  });

  it('discloses the mandatory 37% flat tier above $1M and does not falsely disclaim Additional Medicare', async () => {
    primeCommissionStores();
    renderCard();
    await toCommission();
    expect(screen.queryByText(/Additional Medicare/)).not.toBeInTheDocument();
    expect(screen.queryByText(/matches bonus card/)).not.toBeInTheDocument();
    expect(screen.getByText(/37%/, { exact: false })).toBeInTheDocument();
  });

  it('commission-only disclosure bullets render; bonus-only bullets do not', async () => {
    primeCommissionStores();
    renderCard();
    await toCommission();
    await screen.findByTestId('supplemental-headline');
    expect(screen.getByText(/Clawback \/ chargeback adjustments/i)).toBeInTheDocument();
    expect(screen.getByText(/Self-employment tax/i)).toBeInTheDocument();
    expect(screen.getByText(/State-specific supplemental-wage flat rates/i)).toBeInTheDocument();
    expect(screen.queryByText(/RSU vesting taxes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bonus-period 401\(k\) catch-up/i)).not.toBeInTheDocument();
  });
});

describe('SupplementalPayCard waymark meaning (Wave 17)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStores();
  });

  it('renders the waymark meaning line from already-rendered values (Bonus segment)', async () => {
    primeStores();
    renderCard('supplemental-pay');
    fireEvent.change(await screen.findByLabelText(/Bonus amount/i), { target: { value: '10000' } });
    const meaning = await screen.findByTestId('supplemental-pay-meaning');
    expect(meaning).toHaveTextContent(/after an estimated .* tax on a .* bonus/i);
  });

  it('renders the waymark meaning line (Commission segment)', async () => {
    primeCommissionStores();
    renderCard('supplemental-pay');
    await toCommission();
    const meaning = await screen.findByTestId('supplemental-pay-meaning');
    expect(meaning).toHaveTextContent(/after an estimated .* tax on a .* commission/i);
  });

  it('empty state: headline —, cairn glyph, CTA sentence in the meaning slot', () => {
    renderCard('supplemental-pay');
    expect(screen.getByTestId('supplemental-pay-headline')).toHaveTextContent('—');
    expect(document.querySelector('[data-testid="cairn-glyph"]')).toBeInTheDocument();
  });
});
