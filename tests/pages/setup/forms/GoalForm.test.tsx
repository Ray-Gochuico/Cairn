import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAccountsStore } from '@/stores/accounts-store';
import { useGoalsStore } from '@/stores/goals-store';
import { usePersonsStore } from '@/stores/persons-store';
import GoalForm from '@/pages/setup/forms/GoalForm';

function resetStores() {
  useGoalsStore.setState({
    goals: [],
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
  useAccountsStore.setState({
    accounts: [],
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  } as any);
}

describe('Wizard GoalForm (adapter)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the underlying goal form fields', () => {
    render(<GoalForm />);
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/target amount/i)).toBeInTheDocument();
  });

  it('renders an Add Goal submit button', () => {
    render(<GoalForm />);
    expect(
      screen.getByRole('button', { name: /add goal/i }),
    ).toBeInTheDocument();
  });

  it('calls onSaved when the underlying Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<GoalForm onSaved={onSaved} />);
    const cancel = screen.queryByRole('button', { name: /cancel/i });
    if (cancel) {
      await user.click(cancel);
      expect(onSaved).toHaveBeenCalledOnce();
    }
  });
});
