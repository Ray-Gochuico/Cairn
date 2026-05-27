import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import IncomePopover from '@/components/whatif/levers/IncomePopover';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { useLoansStore } from '@/stores/loans-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { emptyLeverPayload } from '@/lib/scenarios';
import { FilingStatus } from '@/types/enums';
import type { Scenario } from '@/types/scenario';
import type { LeverPayload } from '@/lib/scenarios';

interface ResetStoresOpts {
  twoPersons?: boolean;
  payload?: Partial<LeverPayload>;
  loans?: { currentBalance: number; monthlyPayment: number }[];
}

function resetStores(opts: ResetStoresOpts | boolean = false) {
  const o: ResetStoresOpts = typeof opts === 'boolean' ? { twoPersons: opts } : opts;
  const twoPersons = !!o.twoPersons;
  useHouseholdStore.setState({
    household: {
      filingStatus: twoPersons ? FilingStatus.MFJ : FilingStatus.SINGLE, state: 'CA', city: null,
    } as any,
    isLoading: false, error: null,
  });
  usePersonsStore.setState({
    persons: twoPersons
      ? [{ id: 1, annualSalaryPretax: 135000 } as any, { id: 2, annualSalaryPretax: 92000 } as any]
      : [{ id: 1, annualSalaryPretax: 135000 } as any],
    isLoading: false, error: null,
  });
  useScenariosStore.setState({
    scenarios: [{
      id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid',
      visible: true, isActive: true, sortOrder: 0,
      leverPayload: { ...emptyLeverPayload(), ...(o.payload ?? {}) },
      createdAt: 't', updatedAt: 't',
    } as Scenario],
    isLoading: false, error: null,
    horizonMonths: 360, dollarMode: 'nominal',
    inflation: 0.025, defaultReturnRate: 0.07,
    updateLever: vi.fn().mockResolvedValue(undefined) as any,
  });
  // Stub tax-rules + loans + accounts stores so the new per-person + gap
  // summary blocks can compute against deterministic data.
  useTaxRulesStore.setState({
    items: [
      {
        year: 2026,
        jurisdictionType: 'FEDERAL',
        jurisdictionCode: 'US',
        filingStatus: twoPersons ? FilingStatus.MFJ : FilingStatus.SINGLE,
        brackets: [
          { min: 0, max: 11_600, rate: 0.10 },
          { min: 11_600, max: 47_150, rate: 0.12 },
          { min: 47_150, max: 100_525, rate: 0.22 },
          { min: 100_525, max: 191_950, rate: 0.24 },
          { min: 191_950, max: null, rate: 0.32 },
        ],
        standardDeduction: 14_600,
      },
    ],
    isLoading: false, error: null,
  } as any);
  useLoansStore.setState({
    loans: (o.loans ?? []) as any,
    isLoading: false, error: null,
  } as any);
  useAccountsStore.setState({
    accounts: [],
    isLoading: false, error: null,
  } as any);
}

describe('IncomePopover', () => {
  beforeEach(() => { resetStores(); });

  it('single-person household renders just one tab', () => {
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.queryByRole('tab', { name: /partner/i })).not.toBeInTheDocument();
  });

  it('two-person household renders two tabs', () => {
    resetStores(true);
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: /you/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /partner/i })).toBeInTheDocument();
  });

  it('raise-rate input edits the active person\'s plan (percentage)', () => {
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const slider = screen.getByLabelText(/annual raise rate/i) as HTMLInputElement;
    // Default annualRaiseRate is 0 (salary holds steady) — input renders as "0.00".
    expect(slider.value).toBe('0.00');
    fireEvent.change(slider, { target: { value: '5' } });
    // After commit the controlled input reformats to two-decimal pct.
    expect(slider.value).toBe('5.00');
  });

  it('raise-rate input is stored as a decimal (5% → 0.05 on Apply)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/annual raise rate/i), { target: { value: '5' } });
    await user.click(screen.getByRole('button', { name: /apply/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(1, expect.objectContaining({
      income: expect.objectContaining({
        perPerson: [expect.objectContaining({ annualRaiseRate: 0.05 })],
      }),
    }));
  });

  it('can add a promotion event and Apply writes the income lever slice', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add income event/i }));
    await user.selectOptions(screen.getByLabelText(/type/i), 'promotion');
    fireEvent.change(screen.getByLabelText(/when/i), { target: { value: '2028-04-01' } });
    fireEvent.change(screen.getByLabelText(/new salary/i), { target: { value: '168000' } });
    await user.click(screen.getByRole('button', { name: /apply/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(1, expect.objectContaining({
      income: expect.objectContaining({
        perPerson: [expect.objectContaining({
          events: [expect.objectContaining({ type: 'promotion', when: '2028-04-01', newSalary: 168000 })],
        })],
      }),
    }));
  });

  it('sabbatical event renders the duration field', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add income event/i }));
    await user.selectOptions(screen.getByLabelText(/type/i), 'sabbatical');
    expect(screen.getByLabelText(/duration \(months\)/i)).toBeInTheDocument();
  });

  it('raise event renders the deltaAmount field', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add income event/i }));
    await user.selectOptions(screen.getByLabelText(/type/i), 'raise');
    expect(screen.getByLabelText(/delta amount/i)).toBeInTheDocument();
  });

  it('mirror copies the active tab\'s plan to the other person', async () => {
    resetStores(true);
    const user = userEvent.setup();
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const slider = screen.getByLabelText(/annual raise rate/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '5' } });
    await user.click(screen.getByRole('button', { name: /mirror to partner/i }));
    await user.click(screen.getByRole('tab', { name: /partner/i }));
    expect((screen.getByLabelText(/annual raise rate/i) as HTMLInputElement).value).toBe('5.00');
  });

  it('renders the live trajectory preview at the bottom', () => {
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId('income-trajectory-preview')).toBeInTheDocument();
    const preview = screen.getByTestId('income-trajectory-preview');
    expect(within(preview).getAllByRole('listitem').length).toBeGreaterThanOrEqual(5);
  });
});

describe('IncomePopover — per-person + household + gap summary (revamp 2026-05-26)', () => {
  beforeEach(() => { resetStores(); });

  it('shows per-person row with annual salary and monthly pre-tax / after-tax', () => {
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByText(/Annual salary \(pre-tax\):/i)).toBeInTheDocument();
    // $135k pre-tax → ~$11.25k/mo
    expect(screen.getByText(/\$11,250/)).toBeInTheDocument();
    // After-tax monthly should be lower than pre-tax monthly but positive.
    const afterTax = screen.getByTestId('income-after-tax-monthly-0').textContent ?? '';
    const value = Number(afterTax.replace(/[^0-9.-]/g, ''));
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(11250);
  });

  it('hides the household total row when only one person', () => {
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.queryByTestId('income-household-after-tax-monthly')).not.toBeInTheDocument();
  });

  it('shows the household total row when two persons', () => {
    resetStores({ twoPersons: true });
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId('income-household-after-tax-monthly')).toBeInTheDocument();
  });

  it('shows the monthly gap row equal to after-tax income (no expenses, no loans)', () => {
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const gapEl = screen.getByTestId('income-monthly-gap');
    const value = Number(gapEl.textContent?.replace(/[^0-9.-]/g, '') ?? '0');
    // With no expenses/loans, gap === household after-tax monthly.
    expect(value).toBeGreaterThan(0);
  });

  it('subtracts expense periods from the gap', () => {
    const today = new Date();
    const startISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    resetStores({
      payload: {
        expensePeriods: [{ start: startISO, monthlyDelta: 4500, durationMonths: 12 }],
      },
    });
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const gapEl = screen.getByTestId('income-monthly-gap');
    const value = Number(gapEl.textContent?.replace(/[^0-9.-]/g, '') ?? '0');
    expect(value).toBeGreaterThan(0);
    // Should be less than the no-expenses case.
    expect(value).toBeLessThan(11250);
  });

  it('labels the gap as "Shortfall" when expenses exceed income', () => {
    const today = new Date();
    const startISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    resetStores({
      payload: {
        expensePeriods: [{ start: startISO, monthlyDelta: 20000, durationMonths: 12 }],
      },
    });
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByText(/^Shortfall:$/i)).toBeInTheDocument();
  });

  it('hides the gap allocation editor when the household is in shortfall', () => {
    const today = new Date();
    const startISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    resetStores({
      payload: {
        expensePeriods: [{ start: startISO, monthlyDelta: 20000, durationMonths: 12 }],
      },
    });
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.queryByTestId('gap-allocation-editor')).not.toBeInTheDocument();
  });

  it('renders the gap allocation editor with the surplus magnitude', () => {
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId('gap-allocation-editor')).toBeInTheDocument();
  });

  it('Surplus label wraps in a TermTooltip wired to the SURPLUS glossary key (W6-Design #5)', () => {
    // Regression: pre-fix the term was "Surplus (gap)" which uppercases to
    // "SURPLUS (GAP)" — not a glossary key, so TermTooltip silently fell
    // back to a plain span (no tooltip affordance, no popover on hover).
    // The fix points the term at the actual key (SURPLUS); the visible
    // label "Surplus (gap)" lives in `children`.
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    // The TermTooltip renders as a <button> whose accessible name is the
    // children — "Surplus (gap)" — when the lookup resolves. When the
    // lookup fails the wrapper drops to a plain <span> with no role, so
    // the button query is a precise signal that the key resolved.
    const trigger = screen.getByRole('button', { name: /surplus \(gap\)/i });
    expect(trigger).toBeInTheDocument();
  });

  // ---- Wave-3 Task 1: investment-income inputs (LTCG / qualified divs /
  // non-qualified divs) -------------------------------------------------------
  describe('investment income inputs (Wave-3)', () => {
    it('renders all three investment-income inputs', () => {
      render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
      expect(screen.getByLabelText(/annual long-term capital gains/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/annual qualified dividends/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/annual non-qualified dividends/i)).toBeInTheDocument();
    });

    it('seeds the inputs from the active scenario payload', () => {
      resetStores({
        payload: {
          annualLongTermGains: 50_000,
          annualQualifiedDividends: 3_000,
          annualNonQualifiedDividends: 1_500,
        },
      });
      render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
      expect((screen.getByLabelText(/annual long-term capital gains/i) as HTMLInputElement).value).toBe('50000');
      expect((screen.getByLabelText(/annual qualified dividends/i) as HTMLInputElement).value).toBe('3000');
      expect((screen.getByLabelText(/annual non-qualified dividends/i) as HTMLInputElement).value).toBe('1500');
    });

    it('Apply pushes all three values to updateLever', async () => {
      const user = userEvent.setup();
      const updateLever = vi.fn().mockResolvedValue(undefined);
      useScenariosStore.setState({ updateLever } as any);
      render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);

      const ltcgInput = screen.getByLabelText(/annual long-term capital gains/i);
      await user.clear(ltcgInput);
      await user.type(ltcgInput, '50000');
      const qdInput = screen.getByLabelText(/annual qualified dividends/i);
      await user.clear(qdInput);
      await user.type(qdInput, '3000');

      await user.click(screen.getByRole('button', { name: /^Apply$/i }));

      expect(updateLever).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          annualLongTermGains: 50000,
          annualQualifiedDividends: 3000,
          annualNonQualifiedDividends: 0,
        }),
      );
    });
  });
});
