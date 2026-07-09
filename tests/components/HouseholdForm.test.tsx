import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';
import HouseholdForm, { HOUSEHOLD_DEFAULT_VALUES } from '@/components/forms/HouseholdForm';

const nycCityBrackets = [
  { min: 0, max: 12000, rate: 0.03078 },
  { min: 12000, max: 25000, rate: 0.03762 },
  { min: 25000, max: 50000, rate: 0.03819 },
  { min: 50000, max: null, rate: 0.03876 },
];

function resetStores() {
  useTaxRulesStore.setState({ year: null, items: [], isLoading: false, error: null });
}

function primeNyTaxRules() {
  useTaxRulesStore.setState({
    year: 2026,
    items: [
      {
        id: 1,
        year: 2026,
        jurisdictionType: 'CITY',
        jurisdictionCode: 'NY_NYC',
        filingStatus: FilingStatus.SINGLE,
        brackets: nycCityBrackets,
        standardDeduction: 0,
      },
    ],
    isLoading: false,
    error: null,
  });
}

describe('HouseholdForm city dropdown', () => {
  beforeEach(() => {
    resetStores();
  });

  it('shows city dropdown with NYC option when state is NY and tax rules are loaded', () => {
    primeNyTaxRules();

    render(
      <MemoryRouter>
        <HouseholdForm
          values={{ ...HOUSEHOLD_DEFAULT_VALUES, state: 'NY', city: null }}
          onSubmit={async () => {}}
        />
      </MemoryRouter>,
    );

    const citySelect = screen.getByLabelText(/City/i) as HTMLSelectElement;
    // The (No local tax) default option should be present
    expect(citySelect.querySelector('option[value=""]')).toBeInTheDocument();
    // NYC option should be present with prettified label
    expect(citySelect.querySelector('option[value="NY_NYC"]')).toBeInTheDocument();
    const nycOption = citySelect.querySelector('option[value="NY_NYC"]') as HTMLOptionElement;
    // prettifyCityCode keeps short all-caps acronyms intact → "NYC"
    expect(nycOption.textContent).toBe('NYC');
  });

  it('selecting NYC sets form value to NY_NYC', async () => {
    primeNyTaxRules();

    let submittedCity: string | null | undefined = undefined;

    render(
      <MemoryRouter>
        <HouseholdForm
          values={{ ...HOUSEHOLD_DEFAULT_VALUES, state: 'NY', city: null }}
          onSubmit={async (values) => {
            submittedCity = values.city;
          }}
        />
      </MemoryRouter>,
    );

    const citySelect = screen.getByLabelText(/City/i);
    fireEvent.change(citySelect, { target: { value: 'NY_NYC' } });

    const saveButton = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveButton);

    // Wait for async submit
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(submittedCity).toBe('NY_NYC');
  });

  it('renders withdrawal + inflation as percent-entry fields with % suffixes (Wave 11 T6)', () => {
    primeNyTaxRules();
    render(
      <MemoryRouter>
        <HouseholdForm
          values={{ ...HOUSEHOLD_DEFAULT_VALUES, withdrawalRate: 0.04, inflationAssumption: 0.024 }}
          onSubmit={async () => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/withdrawal rate/i)).toHaveValue(4);
    expect(screen.getByLabelText(/inflation assumption/i)).toHaveValue(2.4);
    expect(screen.getAllByText('%').length).toBeGreaterThanOrEqual(2);
  });

  it('converts percent fields back to stored fractions; untouched resubmit preserves them (Wave 11 T6)', async () => {
    primeNyTaxRules();
    let submitted: { withdrawalRate: number; inflationAssumption: number } | null = null;
    render(
      <MemoryRouter>
        <HouseholdForm
          values={{ ...HOUSEHOLD_DEFAULT_VALUES, withdrawalRate: 0.04, inflationAssumption: 0.024 }}
          onSubmit={async (v) => {
            submitted = { withdrawalRate: v.withdrawalRate, inflationAssumption: v.inflationAssumption };
          }}
        />
      </MemoryRouter>,
    );
    // Dirty an UNRELATED field (Save is disabled until dirty) but leave the
    // rate fields untouched — the stored fractions must survive verbatim
    // (no 100x drift).
    fireEvent.change(screen.getByLabelText(/monthly expense/i), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted).toEqual({ withdrawalRate: 0.04, inflationAssumption: 0.024 });

    submitted = null;
    fireEvent.change(screen.getByLabelText(/withdrawal rate/i), { target: { value: '3.5' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.withdrawalRate).toBeCloseTo(0.035, 10);
    expect(submitted!.inflationAssumption).toBeCloseTo(0.024, 10);
  });

  it('shows no city options when state has no seeded city rules', () => {
    primeNyTaxRules();

    render(
      <MemoryRouter>
        <HouseholdForm
          values={{ ...HOUSEHOLD_DEFAULT_VALUES, state: 'CA', city: null }}
          onSubmit={async () => {}}
        />
      </MemoryRouter>,
    );

    const citySelect = screen.getByLabelText(/City/i) as HTMLSelectElement;
    // Only "(No local tax)" option should appear when no city rules match CA
    const options = citySelect.querySelectorAll('option');
    expect(options.length).toBe(1);
    expect((options[0] as HTMLOptionElement).value).toBe('');
  });
});

describe('HouseholdForm — inline per-field errors + summary labels (round-3 S6)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('an out-of-range withdrawal rate gets an inline error with aria-invalid', async () => {
    const onSubmit = async () => {
      throw new Error('should not submit');
    };
    render(
      <MemoryRouter>
        <HouseholdForm values={{ ...HOUSEHOLD_DEFAULT_VALUES }} onSubmit={onSubmit} />
      </MemoryRouter>,
    );
    const rate = screen.getByLabelText(/withdrawal rate/i);
    fireEvent.change(rate, { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(rate).toHaveAttribute('aria-invalid', 'true');
    });
    expect(rate).toHaveAccessibleDescription('Must be at most 100');
  });

  it('the error summary names fields by their visible labels (round-3 S6)', async () => {
    render(
      <MemoryRouter>
        <HouseholdForm values={{ ...HOUSEHOLD_DEFAULT_VALUES }} onSubmit={async () => {}} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/withdrawal rate/i), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('Withdrawal rate');
    expect(summary).not.toHaveTextContent('Withdrawal rate percent');
  });
});
