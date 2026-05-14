import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    // Title "OT take-home" should also be present in the card header.
    expect(screen.getAllByText(/OT take-home/i).length).toBeGreaterThan(0);
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
    primeStores();
    render(<MemoryRouter><OvertimeCard /></MemoryRouter>);

    // Take headline before changing.
    const initialHeadline = await screen.findByTestId('ot-takehome');
    const initialValue = parseFloat(initialHeadline.textContent!.replace(/[$,]/g, ''));

    // Switch the multiplier preset on row 0 from 1.5x to 2x.
    const select = screen.getAllByLabelText(/Multiplier/i)[0];
    fireEvent.change(select, { target: { value: '2' } });

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
});
