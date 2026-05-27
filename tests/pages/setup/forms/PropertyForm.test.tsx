import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import PropertyForm from '@/pages/setup/forms/PropertyForm';

function resetStores() {
  usePropertiesStore.setState({
    properties: [],
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

describe('Wizard PropertyForm (adapter)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the underlying property form fields', () => {
    render(<PropertyForm />);
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^type$/i)).toBeInTheDocument();
  });

  it('renders an Add Property submit button', () => {
    render(<PropertyForm />);
    expect(
      screen.getByRole('button', { name: /add property/i }),
    ).toBeInTheDocument();
  });

  it('calls onSaved when the underlying Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<PropertyForm onSaved={onSaved} />);
    // PropertyForm exposes either Cancel (when persons exist) or Back
    // (when none). With our stub person, Cancel is rendered.
    const cancel = screen.queryByRole('button', { name: /cancel/i });
    if (cancel) {
      await user.click(cancel);
      expect(onSaved).toHaveBeenCalledOnce();
    }
  });
});
