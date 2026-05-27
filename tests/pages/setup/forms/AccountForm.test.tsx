import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAccountsStore } from '@/stores/accounts-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { usePersonsStore } from '@/stores/persons-store';
import AccountForm from '@/pages/setup/forms/AccountForm';

function resetStores() {
  useAccountsStore.setState({
    accounts: [],
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
  useDependentsStore.setState({
    dependents: [],
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  } as any);
}

describe('Wizard AccountForm (adapter)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the underlying account form fields', () => {
    render(<AccountForm />);
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^type$/i)).toBeInTheDocument();
  });

  it('renders an Add Account submit button', () => {
    render(<AccountForm />);
    expect(
      screen.getByRole('button', { name: /add account/i }),
    ).toBeInTheDocument();
  });

  it('calls onSaved when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<AccountForm onSaved={onSaved} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
