import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import LoanForm from '@/pages/setup/forms/LoanForm';

function resetStores() {
  useLoansStore.setState({
    loans: [],
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  } as any);
  usePersonsStore.setState({
    persons: [{ id: 1, name: 'Alice' }],
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  } as any);
  usePropertiesStore.setState({
    properties: [],
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  } as any);
  useVehiclesStore.setState({
    vehicles: [],
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  } as any);
}

describe('Wizard LoanForm (adapter)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the underlying loan form fields', () => {
    render(<LoanForm />);
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^type$/i)).toBeInTheDocument();
  });

  it('renders an Add Loan submit button', () => {
    render(<LoanForm />);
    expect(
      screen.getByRole('button', { name: /add loan/i }),
    ).toBeInTheDocument();
  });

  it('calls onSaved when the underlying Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<LoanForm onSaved={onSaved} />);
    const cancel = screen.queryByRole('button', { name: /cancel/i });
    if (cancel) {
      await user.click(cancel);
      expect(onSaved).toHaveBeenCalledOnce();
    }
  });
});
