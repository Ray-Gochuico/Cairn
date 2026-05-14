import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    // prettifyCityCode: state prefix dropped, remaining parts title-cased → "Nyc"
    expect(nycOption.textContent).toBe('Nyc');
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
