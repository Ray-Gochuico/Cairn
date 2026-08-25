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
    createWithAnswers: async () => 1,
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

  it('new-account submit routes through createWithAnswers with the collected match answers (Wave A item 2)', async () => {
    const createWithAnswers = vi.fn(async () => 1);
    useAccountsStore.setState({ createWithAnswers } as never);
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<AccountForm onSaved={onSaved} />);
    await user.type(screen.getByLabelText(/^name$/i), 'Work 401k');
    await user.selectOptions(screen.getByLabelText(/^type$/i), 'ACCOUNT_401K');
    await user.selectOptions(screen.getByLabelText(/employer match\?/i), 'yes');
    await user.type(screen.getByLabelText(/match rate/i), '4');
    await user.type(screen.getByLabelText(/match limit/i), '6');
    await user.selectOptions(screen.getByLabelText(/mega-backdoor/i), 'yes');
    await user.click(screen.getByRole('button', { name: /add account/i }));
    await vi.waitFor(() => expect(createWithAnswers).toHaveBeenCalledTimes(1));
    // Percent twins convert at the storage boundary: 4% → 0.04, 6% → 0.06.
    expect(createWithAnswers).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Work 401k',
        hasEmployerMatch: true,
        employerMatchPct: 0.04,
        employerMatchLimitPct: 0.06,
        allowsMegaBackdoorRollover: true,
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });
});
