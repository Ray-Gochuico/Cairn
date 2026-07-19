import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';
import { OvertimeCard } from '@/pages/calculators/OvertimeCard';

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

function resetStores() {
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
  useTaxRulesStore.setState({ year: null, items: [], isLoading: false, error: null });
}

const baseHourlyPerson = {
  id: 1,
  householdId: 1,
  name: 'Alex',
  dateOfBirth: '1990-01-01',
  targetRetirementAge: 65,
  // Wave-9 F13: the REAL HOURLY shape persists annualSalaryPretax = 0 — the
  // wage base lives in the hourly rate ($25 × 40 × 52 = $52,000 derived).
  // The old $100k fixture masked the $0-base bug.
  annualSalaryPretax: 0,
  expectedCommission: 0,
  expectedCommissionFrequency: 'MONTHLY' as const,
  pretax401kPct: 0,
  healthInsuranceMonthlyPremium: 0,
  dependentCareFsaMonthly: 0,
  hsaMonthlyContribution: 0,
  hsaEligible: false,
  employmentType: 'HOURLY' as const,
  hourlyRate: 25,
  regularHoursPerWeek: 40,
  otThresholdHoursPerWeek: 40,
};

function primeStores(personOverrides: Partial<typeof baseHourlyPerson> = {}) {
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
    persons: [{ ...baseHourlyPerson, ...personOverrides }],
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

describe('OvertimeCard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStores();
  });

  it('renders OT take-home headline from line-item inputs', async () => {
    // Setup: HOURLY person, $25/hr, $100k annual notional salary as base context.
    // Default starter row: 8 hrs @ 1.5x = $300 OT gross.
    // Marginal rate at this income (CA SINGLE, salary $100k + $300 OT) ≈ 35%.
    // Expected take-home: somewhere in ($150, $300).
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);

    const headline = await screen.findByTestId('ot-takehome');
    // Card title is "Overtime"; "Total OT take-home" appears in the body summary.
    expect(screen.getAllByText(/Overtime/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Total OT take-home/i).length).toBeGreaterThan(0);
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(150);
    expect(value).toBeLessThan(300);
  });

  it('renders empty state when no eligible person exists', () => {
    // SALARY_NO_OT person — not eligible.
    primeStores({ employmentType: 'SALARY_NO_OT', hourlyRate: null });
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);
    expect(screen.getByText(/No eligible person/i)).toBeInTheDocument();
  });

  it('empty-state CTA links to the destination it names (Wave 15 T10)', () => {
    // SALARY_NO_OT person — not eligible ⇒ no-eligible-person empty state.
    primeStores({ employmentType: 'SALARY_NO_OT', hourlyRate: null });
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);
    expect(
      screen.getByRole('link', { name: /set employment type/i }),
    ).toHaveAttribute('href', '/inputs/persons');
  });

  it('no-household empty-state CTA links to the household inputs it names (D10 completion)', () => {
    // Eligible HOURLY person present ($25/hr seeds the base rate; the default
    // starter row yields $300 OT gross > 0) but household absent — reaches the
    // second arm of the totalGross ternary in the
    // `totalGross <= 0 || !taxResult || !household` branch.
    primeStores();
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);
    expect(
      screen.getByRole('link', { name: /set up your household profile/i }),
    ).toHaveAttribute('href', '/inputs/household');
  });

  it('adding a row updates the per-row breakdown count', async () => {
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);

    // Initial: one row.
    expect(screen.getAllByLabelText(/Hours/i)).toHaveLength(1);

    // Click "Add row" — should now show two row inputs.
    const addBtn = screen.getByRole('button', { name: /Add row/i });
    fireEvent.click(addBtn);
    expect(screen.getAllByLabelText(/Hours/i)).toHaveLength(2);
  });

  it('switching multiplier preset to 2x increases OT gross', async () => {
    const user = userEvent.setup();
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);

    // Take headline before changing.
    const initialHeadline = await screen.findByTestId('ot-takehome');
    const initialValue = parseFloat(initialHeadline.textContent!.replace(/[$,]/g, ''));

    // Switch the multiplier preset on row 0 from 1.5x to 2x via Radix combobox.
    const row0 = screen.getByTestId('ot-row-0');
    await user.click(within(row0).getByRole('combobox', { name: /multiplier/i }));
    await user.click(await screen.findByRole('option', { name: /2x/i }));

    const newHeadline = await screen.findByTestId('ot-takehome');
    const newValue = parseFloat(newHeadline.textContent!.replace(/[$,]/g, ''));
    // 8 hrs @ 2x = $400 gross > 8 hrs @ 1.5x = $300 gross → take-home should rise.
    expect(newValue).toBeGreaterThan(initialValue);
  });

  it('uses implied hourly rate for SALARY_WITH_OT person', async () => {
    // $52,000 / (40 × 52) = exactly $25/hr → 8 hrs @ 1.5x = $300 gross — same shape as HOURLY test.
    primeStores({
      employmentType: 'SALARY_WITH_OT',
      hourlyRate: null,
      annualSalaryPretax: 52000,
    });
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);

    const headline = await screen.findByTestId('ot-takehome');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    // Marginal rate at $52k salary in CA SINGLE is much lower (~22% federal + ~6% CA + 7.65% FICA ≈ 35%)
    // Take-home on $300 should be ~$200 — somewhere between $150 and $300.
    expect(value).toBeGreaterThan(150);
    expect(value).toBeLessThan(300);
  });

  it('applies holiday stack=true → effective multiplier = base × holiday', async () => {
    // HOURLY @ $25/hr, default 1.5x base, switch to 4 hours, holiday=2, stacked.
    // Effective = 1.5 × 2 = 3.0  →  gross = 4 × 25 × 3 = $300.
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);

    // Set hours to 4 on row 0.
    const hoursInput = screen.getAllByLabelText(/Hours/i)[0];
    fireEvent.change(hoursInput, { target: { value: '4' } });

    // Set holiday multiplier on row 0 to 2.
    const holidayInput = screen.getAllByLabelText(/Holiday multiplier/i)[0];
    fireEvent.change(holidayInput, { target: { value: '2' } });

    // Check the "Stack with base" checkbox on row 0.
    const stackCheckbox = screen.getAllByLabelText(/Stack with base/i)[0];
    fireEvent.click(stackCheckbox);

    // Per-row breakdown row 0 should show gross = $300.
    const breakdownRow = await screen.findByTestId('ot-row-result-0');
    expect(breakdownRow.textContent).toContain('300');

    // Headline take-home on $300 OT at this income (~35% marginal) → ~$195.
    const headline = await screen.findByTestId('ot-takehome');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(150);
  });

  it('still renders with stale (non-current) tax-rule year via getCurrentTaxYear fallback', async () => {
    // Seed household + HOURLY person, but tax rules ONLY for 2025 (older than
    // current calendar year). The card's getCurrentTaxYear() resolver should
    // pick 2025 as the most-recent seeded year and the lookup must find rules.
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
      persons: [{ ...baseHourlyPerson }],
      isLoading: false,
      error: null,
    });
    useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
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

    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);

    // Default starter row: 8 hrs @ 1.5x = $300 OT gross. Card should render
    // the take-home headline using the stale 2025 rules — no crash, no empty state.
    const headline = await screen.findByTestId('ot-takehome');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(value).toBeGreaterThan(150);
    expect(value).toBeLessThan(300);
  });

  it('user enters custom multiplier 1.75x', async () => {
    // HOURLY @ $25/hr, default row of 4 hours, switch preset to custom, enter 1.75.
    // Gross = 4 × 25 × 1.75 = $175.
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);

    // Set hours to 4 on row 0.
    const hoursInput = screen.getAllByLabelText(/Hours/i)[0];
    fireEvent.change(hoursInput, { target: { value: '4' } });

    // Switch the preset to "Custom" via Radix combobox.
    const row0 = screen.getByTestId('ot-row-0');
    const user = userEvent.setup();
    await user.click(within(row0).getByRole('combobox', { name: /multiplier/i }));
    await user.click(await screen.findByRole('option', { name: /custom/i }));

    // The "Custom multiplier" input should now appear.
    const customInput = await screen.findByLabelText(/Custom multiplier/i);
    fireEvent.change(customInput, { target: { value: '1.75' } });

    // Per-row breakdown row 0 should show gross = $175.
    const breakdownRow = await screen.findByTestId('ot-row-result-0');
    expect(breakdownRow.textContent).toContain('175');
  });

  it('entering a shift differential on row 0 increases OT gross', async () => {
    // HOURLY @ $25/hr, default row: 8 hrs @ 1.5x.
    // No shift diff: gross = 8 × 25 × 1.5 = $300.
    // Shift diff = $3/hr: gross = 8 × 28 × 1.5 = $336 → take-home increases.
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);

    // Wait for the initial take-home to render.
    const initialHeadline = await screen.findByTestId('ot-takehome');
    const initialValue = parseFloat(initialHeadline.textContent!.replace(/[$,]/g, ''));

    // Enter a shift differential of $3/hr on row 0.
    const shiftDiffInput = screen.getByLabelText(/Shift diff/i);
    fireEvent.change(shiftDiffInput, { target: { value: '3' } });

    // The per-row breakdown for row 0 should now reflect the higher effective rate.
    const breakdownRow = await screen.findByTestId('ot-row-result-0');
    // Effective base rate = $28.00 → breakdown shows "$28.00" (or "28" in the text).
    expect(breakdownRow.textContent).toContain('28');

    // Take-home should increase relative to the no-diff baseline.
    const newHeadline = await screen.findByTestId('ot-takehome');
    const newValue = parseFloat(newHeadline.textContent!.replace(/[$,]/g, ''));
    expect(newValue).toBeGreaterThan(initialValue);
  });

  it('renders OBBBA deduction row and caveat when eligible person has OT hours', async () => {
    // Default primeStores: HOURLY @ $25/hr, starter row 8 hrs @ 1.5x.
    // totalPremium = 8 × 25 × (1.5 - 1) = 100. obbbaDeduction = 100 (<$12,500).
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);

    // Wait for the card to reach the populated path (headline present).
    await screen.findByTestId('ot-takehome');

    // OBBBA est. federal tax saved row must render.
    const obbbaRow = await screen.findByTestId('ot-obbba-deduction');
    expect(obbbaRow).toBeInTheDocument();

    // The caveat paragraph must mention phase-out, sunsets, or FICA. (Wave 15
    // T3: the NOT-modeled disclosure legitimately matches too — getAllByText.)
    expect(screen.getAllByText(/phase-out|sunsets|FICA/i).length).toBeGreaterThanOrEqual(1);
  });

  it('T6 Fix-6: OBBBA deduction/tax-saved are labeled as annual', async () => {
    // Default primeStores: HOURLY @ $25/hr, starter row 8 hrs @ 1.5x, BI_WEEKLY period.
    // totalPremium (per-period) = 8 × 25 × (1.5 - 1) = $100.
    // annualPremium = 100 × 26 = $2,600. deduction = $2,600 (< $12,500 cap).
    // Est. annual federal tax saved ≈ $2,600 × ~22% = ~$572.
    // Per-period tax saved would have been $100 × ~22% = ~$22.
    // The displayed "Est. annual federal tax saved" (testId=ot-obbba-deduction)
    // must reflect the annual figure, not the per-period figure.
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);

    await screen.findByTestId('ot-takehome');

    // The OBBBA tax-saved row uses testId=ot-obbba-deduction.
    const obbbaRow = await screen.findByTestId('ot-obbba-deduction');
    const rawValue = parseFloat(obbbaRow.textContent!.replace(/[$,]/g, ''));
    // Annual (~$572) >> per-period (~$22). Any value >= 100 confirms annualization.
    expect(rawValue).toBeGreaterThanOrEqual(100);

    // The label must say "annual" (not be unlabeled as per-period).
    expect(screen.getByText(/est\. annual federal tax saved/i)).toBeInTheDocument();
  });

  it('T21: switching Bi-weekly → Weekly re-annualizes the OBBBA figure across 52 periods (kills the hardcoded-26)', async () => {
    // Same 8h premium row; annualization multiplies by periods/year (26 vs 52).
    // Wave 15 T3: the tax stack now annualizes WITH the OBBBA stack, so the
    // federal marginal rate on OT is measured on the ANNUAL OT gross (300 ×
    // ppy). Weekly is no longer exactly 2× bi-weekly — $15,600 of annual OT
    // crosses into the 22% bracket — so pin the exact re-derived oracle
    // figures instead of the old constant-rate doubling. A mutation that
    // hardcodes 26 instead of periodsPerYear(period) would leave the weekly
    // figure at the bi-weekly value and fail the second assertion.
    const { aggregateHouseholdPretax, computeSupplementalWageTax } = await import(
      '@/lib/calculators/supplemental-wage'
    );
    const { formatCurrency } = await import('@/lib/format');
    const expectedSavedFor = (ppy: number) => {
      const effective = { ...baseHourlyPerson, annualSalaryPretax: 25 * 40 * 52 };
      const agg = aggregateHouseholdPretax([effective], {
        filingStatus: FilingStatus.SINGLE, personCount: 1, dependentCount: 0,
      });
      const res = computeSupplementalWageTax({
        baseSalary: agg.totalSalary,
        supplementalWages: 300 * ppy,
        pretax: agg.pretax,
        filingStatus: FilingStatus.SINGLE,
        federalBrackets: federalSingleBrackets,
        stateBrackets: caSingleBrackets,
        cityBrackets: null,
        standardDeduction: { federal: 15000, state: 0, city: 0 },
        perPersonBaseSalary: [52_000],
        recipientIndex: 0,
      });
      // Qualified half-time premium: 8h × $25 × 0.5 = $100/period, ×ppy, capped.
      const deduction = Math.min(100 * ppy, 12_500);
      return formatCurrency(deduction * (res.bonusBreakdown.federal / (300 * ppy)));
    };

    const user = userEvent.setup();
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);
    await screen.findByTestId('ot-takehome');

    expect((await screen.findByTestId('ot-obbba-deduction')).textContent).toBe(
      expectedSavedFor(26),
    );

    await user.click(screen.getByRole('combobox', { name: /pay period/i }));
    await user.click(await screen.findByRole('option', { name: /^weekly$/i }));

    expect(screen.getByTestId('ot-obbba-deduction').textContent).toBe(expectedSavedFor(52));
    // Sanity: the two oracle figures differ, so a hardcoded-26 mutation can't pass both.
    expect(expectedSavedFor(52)).not.toBe(expectedSavedFor(26));
  });

  it('headline equals computeSupplementalWageTax wiring exactly on the ANNUALIZED stack (parity, single eligible person; REPEATS default)', async () => {
    const { aggregateHouseholdPretax, computeSupplementalWageTax } = await import(
      '@/lib/calculators/supplemental-wage'
    );
    const { formatCurrency } = await import('@/lib/format');
    primeStores(); // HOURLY @ $25/hr, all pretax 0; default row 8h @ 1.5x = $300 gross, BI_WEEKLY
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);

    const headline = await screen.findByTestId('ot-takehome');

    // Mirror the card: aggregate the SINGLE eligible person (household-wide caps
    // still count everyone — here personCount = 1, dependentCount = 0).
    // Wave-9 F13: the HOURLY earner's wage base derives from rate × hours × 52.
    const effective = { ...baseHourlyPerson, annualSalaryPretax: 25 * 40 * 52 };
    const agg = aggregateHouseholdPretax(
      [effective],
      { filingStatus: FilingStatus.SINGLE, personCount: 1, dependentCount: 0 },
    );
    const expected = computeSupplementalWageTax({
      baseSalary: agg.totalSalary,           // 52000 (derived)
      supplementalWages: 300 * 26,           // Wave 15 T3: the YEAR's OT (REPEATS default), not one period's
      pretax: agg.pretax,
      filingStatus: FilingStatus.SINGLE,
      federalBrackets: federalSingleBrackets,
      stateBrackets: caSingleBrackets,
      cityBrackets: null,
      standardDeduction: { federal: 15000, state: 0, city: 0 },
      perPersonBaseSalary: [52_000],
      recipientIndex: 0,
    });

    // Headline stays "take-home from this period's entered OT": annual ÷ ppy.
    expect(headline.textContent).toBe(formatCurrency(expected.bonusTakeHome / 26));

    // T3 review M3: the REPEATS rollup row renders the EXACT annual figure
    // from the same oracle — not ppy × the rounded per-period headline.
    expect(screen.getByText(/estimated annual OT take-home/i)).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(expected.bonusTakeHome))).toBeInTheDocument();
  });

  it('the false "Display only" caption is gone; a recurrence control exists', async () => {
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);
    await screen.findByTestId('ot-takehome');
    expect(screen.queryByText(/display only/i)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /recurrence/i })).toBeInTheDocument();
  });

  it('ONE_OFF: neither the tax stack nor OBBBA annualizes', async () => {
    const { aggregateHouseholdPretax, computeSupplementalWageTax } = await import(
      '@/lib/calculators/supplemental-wage'
    );
    const { formatCurrency } = await import('@/lib/format');
    const user = userEvent.setup();
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);
    await screen.findByTestId('ot-takehome');

    await user.click(screen.getByRole('combobox', { name: /recurrence/i }));
    await user.click(await screen.findByRole('option', { name: /one-off/i }));

    const headline = screen.getByTestId('ot-takehome');
    const effective = { ...baseHourlyPerson, annualSalaryPretax: 25 * 40 * 52 };
    const agg = aggregateHouseholdPretax([effective], {
      filingStatus: FilingStatus.SINGLE, personCount: 1, dependentCount: 0,
    });
    const expected = computeSupplementalWageTax({
      baseSalary: agg.totalSalary,
      supplementalWages: 300, // ONE_OFF: just these hours, no ×ppy
      pretax: agg.pretax,
      filingStatus: FilingStatus.SINGLE,
      federalBrackets: federalSingleBrackets,
      stateBrackets: caSingleBrackets,
      cityBrackets: null,
      standardDeduction: { federal: 15000, state: 0, city: 0 },
      perPersonBaseSalary: [52_000],
      recipientIndex: 0,
    });
    expect(headline.textContent).toBe(formatCurrency(expected.bonusTakeHome));

    // T3 review M3: the annual rollup row is a REPEATS-only concept.
    expect(screen.queryByText(/estimated annual OT take-home/i)).not.toBeInTheDocument();
    // T3 review I1: recurrence is ephemeral UI state (plain useState), not
    // "my data" — flipping it alone must not surface the Reset affordance.
    expect(screen.queryByText(/reset to my data/i)).not.toBeInTheDocument();
  });

  it('exposes a "What this calculator does NOT model" disclosure (family idiom)', async () => {
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);
    await screen.findByTestId('ot-takehome');
    const summary = screen.getByText(/What this calculator does NOT model/i);
    fireEvent.click(summary);
    expect(screen.getByText(/daily-overtime rules/i)).toBeInTheDocument();
    // "exempt" appears in both the bullet's <strong> heading and its body text,
    // and "sunsets after 2028" also lives in the OBBBA caveat paragraph — use
    // getAllByText for those (Retirement401kWithdrawalCard disclosure-test idiom).
    expect(screen.getAllByText(/exempt/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/sunsets after 2028/i).length).toBeGreaterThanOrEqual(2);
  });

  it("derives an HOURLY earner's wage base from rate × hours × 52 (wave-9 F13)", async () => {
    // $25/hr × 40h × 52 = $52,000 base. Pre-fix the base was $0 → OT taxed
    // at the bottom bracket (marginal 7.65%, FICA only).
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);
    await screen.findByTestId('ot-takehome');
    const label = screen.getByText(/Marginal rate on OT/i);
    const row = label.closest('div')!.parentElement as HTMLElement;
    const pct = parseFloat((row.textContent ?? '').replace(/[^\d.]/g, ''));
    // Pre-fix (base $0) the OT marginal was FICA-only, rendering "7.7%". A
    // real $52k base stacks federal (12%) + CA on top → well above 10%.
    expect(pct).toBeGreaterThan(10);
  });

  it('stacks OT on the HOUSEHOLD base like Bonus/Commission (wave-9 M59)', async () => {
    // HOURLY earner ($52k derived) + $200k salaried partner, MFJ: the OT
    // premium must be taxed at the household's bracket, not the single
    // earner's. Oracle: computeSupplementalWageTax with baseSalary 252k,
    // perPersonBaseSalary [52k, 200k], recipientIndex 0.
    const { aggregateHouseholdPretax, computeSupplementalWageTax } = await import(
      '@/lib/calculators/supplemental-wage'
    );
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
    const partner = {
      ...baseHourlyPerson,
      id: 2,
      name: 'Sam',
      employmentType: 'SALARY_NO_OT' as const,
      hourlyRate: null,
      annualSalaryPretax: 200000,
    };
    usePersonsStore.setState({
      persons: [{ ...baseHourlyPerson }, partner],
      isLoading: false,
      error: null,
    });
    const items = useTaxRulesStore.getState().items.map((i) => ({
      ...i,
      filingStatus: FilingStatus.MFJ,
    }));
    useTaxRulesStore.setState({ year: 2026, items, isLoading: false, error: null });

    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);
    const headline = await screen.findByTestId('ot-takehome');

    const effective = { ...baseHourlyPerson, annualSalaryPretax: 52_000 };
    const agg = aggregateHouseholdPretax([effective, partner], {
      filingStatus: FilingStatus.MFJ,
      personCount: 2,
      dependentCount: 0,
    });
    const expected = computeSupplementalWageTax({
      baseSalary: agg.totalSalary, // 252000
      supplementalWages: 300,
      pretax: agg.pretax,
      filingStatus: FilingStatus.MFJ,
      federalBrackets: federalSingleBrackets,
      stateBrackets: caSingleBrackets,
      cityBrackets: null,
      standardDeduction: { federal: 15000, state: 0, city: 0 },
      perPersonBaseSalary: [52_000, 200_000],
      recipientIndex: 0,
    });
    expect(headline.textContent).toBe(formatCurrency(expected.bonusTakeHome));
  });

  // a11y T7 finding 3: the "Pay period" select caption must be a <Label> with
  // htmlFor pointing at the SelectTrigger id="ot-period", so clicking the label
  // focuses the trigger (and screen readers announce "Pay period" as its label).
  it('Pay period caption is a <label> with htmlFor="ot-period"', async () => {
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);
    // Wait for the full card to render
    await screen.findByTestId('ot-takehome');
    // There's a <label> element whose htmlFor is "ot-period"
    const label = document.querySelector('label[for="ot-period"]');
    expect(label).not.toBeNull();
    expect(label!.textContent).toMatch(/Pay period/i);
  });

  // a11y T7 finding 3: the OvertimeRowEditor's "Multiplier" caption must be
  // a <label> with htmlFor pointing at the SelectTrigger (id="ot-row-0-preset").
  it('Multiplier caption in OvertimeRowEditor is a <label> with htmlFor for the select trigger', async () => {
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);
    await screen.findByTestId('ot-takehome');
    // The first row's multiplier select trigger has id="ot-row-0-preset"
    const label = document.querySelector('label[for="ot-row-0-preset"]');
    expect(label).not.toBeNull();
    expect(label!.textContent).toMatch(/Multiplier/i);
  });

  it('OBBBA deduction uses only the QUALIFIED half-time premium for a double-time row (wave-9 M62)', async () => {
    const user = userEvent.setup();
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);
    await screen.findByTestId('ot-takehome');

    // Switch row 0 from 1.5x to 2x: full premium/period = 8 × 25 × 1.0 = $200,
    // qualified = 8 × 25 × 0.5 = $100. Annual (BI_WEEKLY, 26): full $5,200 vs
    // qualified $2,600 — the deduction row must show $2,600.
    const row0 = screen.getByTestId('ot-row-0');
    await user.click(within(row0).getByRole('combobox', { name: /multiplier/i }));
    await user.click(await screen.findByRole('option', { name: /2x/i }));

    expect(await screen.findByText('$2,600')).toBeInTheDocument();
    expect(screen.queryByText('$5,200')).not.toBeInTheDocument();
    expect(
      screen.getByText(/only the FLSA half-time portion of your premium qualifies/i),
    ).toBeInTheDocument();
  });

  it('MFS household gets NO OBBBA deduction and sees the caveat (wave-9 M60)', async () => {
    primeStores();
    useHouseholdStore.setState({
      household: {
        ...useHouseholdStore.getState().household!,
        filingStatus: FilingStatus.MFS,
      },
      isLoading: false,
      error: null,
    });
    const items = useTaxRulesStore.getState().items.map((i) => ({
      ...i,
      filingStatus: FilingStatus.MFS,
    }));
    useTaxRulesStore.setState({ year: 2026, items, isLoading: false, error: null });

    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);
    await screen.findByTestId('ot-takehome');
    // Deduction is $0 → the OBBBA block does not render at all…
    expect(screen.queryByTestId('ot-obbba-deduction')).not.toBeInTheDocument();
    // …and the MFS caveat explains why.
    expect(
      screen.getByText(/married filing separately doesn't qualify for the OBBBA overtime deduction/i),
    ).toBeInTheDocument();
  });
});

describe('OvertimeCard waymark meaning (Wave 17)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStores();
  });

  it('renders the waymark meaning line from already-rendered values (Wave 17)', async () => {
    primeStores();
    render(<MemoryRouter><OvertimeCard cardId="overtime" /></MemoryRouter>);
    const meaning = await screen.findByTestId('overtime-meaning');
    expect(meaning).toHaveTextContent(/take-home on .* of overtime gross/i);
  });

  it('empty state (no eligible person): headline —, cairn glyph, CTA in the meaning slot', () => {
    render(<MemoryRouter><OvertimeCard cardId="overtime" /></MemoryRouter>);
    expect(screen.getByTestId('overtime-headline')).toHaveTextContent('—');
    expect(document.querySelector('[data-testid="cairn-glyph"]')).toBeInTheDocument();
    expect(screen.getByTestId('overtime-meaning')).toHaveTextContent(/no eligible person/i);
  });
});
