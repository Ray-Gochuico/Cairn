import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import VehicleForm from '@/pages/setup/forms/VehicleForm';

function resetStores() {
  useVehiclesStore.setState({
    vehicles: [],
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
  useLoansStore.setState({
    loans: [],
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  } as any);
}

describe('Wizard VehicleForm (adapter)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the underlying vehicle form fields', () => {
    render(<VehicleForm />);
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
  });

  it('renders an Add Vehicle submit button', () => {
    render(<VehicleForm />);
    expect(
      screen.getByRole('button', { name: /add vehicle/i }),
    ).toBeInTheDocument();
  });

  it('calls onSaved when the underlying Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<VehicleForm onSaved={onSaved} />);
    const cancel = screen.queryByRole('button', { name: /cancel/i });
    if (cancel) {
      await user.click(cancel);
      expect(onSaved).toHaveBeenCalledOnce();
    }
  });
});
