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
  // For SALARY_WITH_OT we still need an annualSalary; for HOURLY we use hourlyRate.
  annualSalaryPretax: 100000,
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

    // The caveat paragraph must mention phase-out, sunsets, or FICA.
    expect(screen.getByText(/phase-out|sunsets|FICA/i)).toBeInTheDocument();
  });

  it('headline equals computeSupplementalWageTax wiring exactly (parity, single eligible person)', async () => {
    const { aggregateHouseholdPretax, computeSupplementalWageTax } = await import(
      '@/lib/calculators/supplemental-wage'
    );
    const { formatCurrency } = await import('@/lib/format');
    primeStores(); // HOURLY @ $25/hr, $100k salary, all pretax 0; default row 8h @ 1.5x = $300 gross
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);

    const headline = await screen.findByTestId('ot-takehome');

    // Mirror the card: aggregate the SINGLE eligible person (household-wide caps
    // still count everyone — here personCount = 1, dependentCount = 0).
    const agg = aggregateHouseholdPretax(
      [{ ...baseHourlyPerson }],
      { filingStatus: FilingStatus.SINGLE, personCount: 1, dependentCount: 0 },
    );
    const expected = computeSupplementalWageTax({
      baseSalary: agg.totalSalary,           // 100000
      supplementalWages: 300,                // 8 hrs × $25 × 1.5
      pretax: agg.pretax,
      filingStatus: FilingStatus.SINGLE,
      federalBrackets: federalSingleBrackets,
      stateBrackets: caSingleBrackets,
      cityBrackets: null,
      standardDeduction: { federal: 15000, state: 0, city: 0 },
    });

    expect(headline.textContent).toBe(formatCurrency(expected.bonusTakeHome));
  });
});
