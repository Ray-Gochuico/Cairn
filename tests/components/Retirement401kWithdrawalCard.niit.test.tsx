import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';
import { Retirement401kWithdrawalCard } from '@/pages/calculators/Retirement401kWithdrawalCard';

// Wave-5 NEW-W5-2 — NIIT (3.8% surtax under IRC §1411) is now wired into
// the 401k Withdrawal calculator's incremental-tax path. The 401k
// distribution itself isn't investment income (qualified-plan exclusion),
// but the MAGI bump can newly trigger or increase NIIT on the household's
// OTHER investment income (interest, non-qualified divs, passive rental,
// existing cap gains).
//
// Thresholds (static since 2013): $200k SINGLE/HOH, $250k MFJ, $125k MFS.

const federalSingleBrackets = [
  { min: 0,       max: 11_600,  rate: 0.10 },
  { min: 11_600,  max: 47_150,  rate: 0.12 },
  { min: 47_150,  max: 100_525, rate: 0.22 },
  { min: 100_525, max: 191_950, rate: 0.24 },
  { min: 191_950, max: 243_725, rate: 0.32 },
  { min: 243_725, max: null,    rate: 0.35 },
];

const federalMfjBrackets = [
  { min: 0,       max: 23_200,  rate: 0.10 },
  { min: 23_200,  max: 94_300,  rate: 0.12 },
  { min: 94_300,  max: 201_050, rate: 0.22 },
  { min: 201_050, max: 383_900, rate: 0.24 },
  { min: 383_900, max: 487_450, rate: 0.32 },
  { min: 487_450, max: null,    rate: 0.35 },
];

const caFlatBrackets = [{ min: 0, max: null, rate: 0.05 }];

function resetStores() {
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  useTaxRulesStore.setState({ year: null, items: [], isLoading: false, error: null });
}

function primeStores(opts: {
  filingStatus?: FilingStatus;
  annualSalary?: number;
} = {}) {
  const fs = opts.filingStatus ?? FilingStatus.MFJ;
  const salary = opts.annualSalary ?? 200_000;
  useHouseholdStore.setState({
    household: {
      filingStatus: fs,
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
        annualSalaryPretax: salary,
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
        filingStatus: fs,
        brackets: fs === FilingStatus.MFJ ? federalMfjBrackets : federalSingleBrackets,
        standardDeduction: fs === FilingStatus.MFJ ? 29_200 : 14_600,
      },
      {
        id: 2,
        year: 2026,
        jurisdictionType: 'STATE',
        jurisdictionCode: 'CA',
        filingStatus: fs,
        brackets: caFlatBrackets,
        standardDeduction: 0,
      },
    ],
    isLoading: false,
    error: null,
  });
}

describe('Retirement401kWithdrawalCard — NIIT delta', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders a "NIIT delta" line in the breakdown rows', () => {
    primeStores({ filingStatus: FilingStatus.MFJ });
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/withdrawal amount/i), {
      target: { value: '50000' },
    });
    const row = screen.getByTestId('401k-withdrawal-niit-row');
    expect(row).toBeInTheDocument();
    expect(within(row).getByText(/NIIT/)).toBeInTheDocument();
  });

  it('exposes the "Other investment income" input alongside cap gains', () => {
    primeStores({ filingStatus: FilingStatus.MFJ });
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    expect(
      screen.getByLabelText(/other investment income/i),
    ).toBeInTheDocument();
  });

  it('shows $0 NIIT when MAGI stays below the $250k MFJ threshold both with + without the withdrawal', () => {
    // $50k W-2 + $20k other inv inc + $50k withdrawal = $120k MAGI < $250k → 0 NIIT.
    primeStores({ filingStatus: FilingStatus.MFJ, annualSalary: 50_000 });
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/age at withdrawal/i), {
      target: { value: '67' },
    });
    fireEvent.change(screen.getByLabelText(/other investment income/i), {
      target: { value: '20000' },
    });
    fireEvent.change(screen.getByLabelText(/withdrawal amount/i), {
      target: { value: '50000' },
    });
    const row = screen.getByTestId('401k-withdrawal-niit-row');
    expect(within(row).getByText('$0')).toBeInTheDocument();
  });

  it('triggers NIIT when the withdrawal pushes MFJ MAGI past $250k (Wave-5 NEW-W5-2 headline case)', () => {
    // Scenario from the bundle prompt:
    //   MFJ, $200k W-2 + $0 cap gains + $0 other inv inc (set via UI),
    //   $100k withdrawal pushes MAGI 200k → 300k.
    // We give them $50k of OTHER investment income so NIIT has a base to bite.
    //   Without withdrawal: MAGI=$250k, NII=$50k → magiExcess=0, NIIT=0.
    //   With withdrawal:    MAGI=$350k, NII=$50k → magiExcess=$100k,
    //                       base=min(50k, 100k)=$50k, NIIT=3.8% × $50k = $1,900.
    primeStores({ filingStatus: FilingStatus.MFJ, annualSalary: 200_000 });
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/age at withdrawal/i), {
      target: { value: '67' },
    });
    fireEvent.change(screen.getByLabelText(/other investment income/i), {
      target: { value: '50000' },
    });
    fireEvent.change(screen.getByLabelText(/withdrawal amount/i), {
      target: { value: '100000' },
    });
    const row = screen.getByTestId('401k-withdrawal-niit-row');
    expect(within(row).getByText('$1,900')).toBeInTheDocument();
  });

  it('handles the partial-threshold case where the withdrawal only partly crosses MAGI', () => {
    // MFJ, $220k W-2 + $30k other inv inc → MAGI=$250k (exactly at threshold,
    // 0 NIIT without). Adding a $20k withdrawal:
    //   MAGI=$270k, NII=$30k, magiExcess=$20k → base=min(30k, 20k)=$20k,
    //   NIIT = 3.8% × $20k = $760.
    primeStores({ filingStatus: FilingStatus.MFJ, annualSalary: 220_000 });
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/age at withdrawal/i), {
      target: { value: '67' },
    });
    fireEvent.change(screen.getByLabelText(/other investment income/i), {
      target: { value: '30000' },
    });
    fireEvent.change(screen.getByLabelText(/withdrawal amount/i), {
      target: { value: '20000' },
    });
    const row = screen.getByTestId('401k-withdrawal-niit-row');
    expect(within(row).getByText('$760')).toBeInTheDocument();
  });

  it('uses the $200k SINGLE threshold when household is SINGLE', () => {
    // SINGLE, $150k W-2 + $80k other inv inc → MAGI=$230k. Already above
    // SINGLE $200k threshold without the withdrawal:
    //   Without: magiExcess=$30k, base=min(80k, 30k)=$30k → NIIT=$1,140.
    //   With $50k withdrawal: MAGI=$280k, magiExcess=$80k, base=$80k → NIIT=$3,040.
    // Delta = $3,040 - $1,140 = $1,900.
    primeStores({ filingStatus: FilingStatus.SINGLE, annualSalary: 150_000 });
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/age at withdrawal/i), {
      target: { value: '67' },
    });
    fireEvent.change(screen.getByLabelText(/other investment income/i), {
      target: { value: '80000' },
    });
    fireEvent.change(screen.getByLabelText(/withdrawal amount/i), {
      target: { value: '50000' },
    });
    const row = screen.getByTestId('401k-withdrawal-niit-row');
    expect(within(row).getByText('$1,900')).toBeInTheDocument();
  });

  it('removes NIIT from the "What this calculator does NOT model" disclosure list', () => {
    primeStores({ filingStatus: FilingStatus.MFJ });
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
    // Expand the disclosure.
    const disclosure = screen.getByText(/what this calculator does NOT model/i);
    const list = disclosure.parentElement?.querySelector('ul');
    expect(list).not.toBeNull();
    // The NIIT bullet ("engine added this 2026-05-26 but this calculator…")
    // is gone — NIIT is no longer in the omission list because the
    // calculator now routes through it.
    expect(list?.textContent ?? '').not.toMatch(
      /does not yet route through it/i,
    );
  });
});
