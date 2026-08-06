import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import HouseholdForm, { HOUSEHOLD_DEFAULT_VALUES } from '@/components/forms/HouseholdForm';

beforeEach(() => {
  useTaxRulesStore.setState({
    year: null,
    items: [],
    isLoading: false,
    error: null,
    loadYear: async () => {},
  } as never);
});

describe('HouseholdForm growth-scenarios editor (Wave C C6/IN-G1)', () => {
  it('renders one row per stored scenario with percent rates', () => {
    render(<HouseholdForm values={HOUSEHOLD_DEFAULT_VALUES} onSubmit={vi.fn()} />);
    expect(screen.getByText('Growth scenarios')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Conservative')).toBeInTheDocument();
    expect(screen.getByDisplayValue('5')).toBeInTheDocument(); // 0.05 → 5
  });

  it('add + edit round-trips FRACTIONS to onSubmit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<HouseholdForm values={HOUSEHOLD_DEFAULT_VALUES} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Add scenario' }));
    const labels = screen.getAllByLabelText('Label');
    const rates = screen.getAllByLabelText('Rate (%)');
    await user.type(labels[labels.length - 1], 'Custom');
    await user.clear(rates[rates.length - 1]); // the appended row defaults to 6
    await user.type(rates[rates.length - 1], '9');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        growthScenarios: expect.arrayContaining([{ label: 'Custom', rate: 0.09 }]),
      }),
    );
  });

  it('Wave C review (MINOR 8): the Moderate-headline hint renders with the editor', () => {
    render(<HouseholdForm values={HOUSEHOLD_DEFAULT_VALUES} onSubmit={vi.fn()} />);
    expect(
      screen.getByText(
        "Calculators headline the 'Moderate' scenario — renaming it changes which row they use.",
      ),
    ).toBeInTheDocument();
  });

  it('removing a row drops it from the submitted array', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<HouseholdForm values={HOUSEHOLD_DEFAULT_VALUES} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Remove Conservative' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const arg = onSubmit.mock.calls[0][0];
    expect(arg.growthScenarios.map((g: { label: string }) => g.label)).not.toContain('Conservative');
  });
});
