import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDependentsStore } from '@/stores/dependents-store';
import DependentForm from '@/pages/setup/forms/DependentForm';

describe('Wizard DependentForm (adapter)', () => {
  beforeEach(() => {
    useDependentsStore.setState({
      dependents: [],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update: async () => {},
      remove: async () => {},
    } as any);
  });

  it('renders the underlying dependent form fields', () => {
    render(<DependentForm />);
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /date of birth/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/type/i)).toBeInTheDocument();
  });

  it('renders an Add Dependent submit button', () => {
    render(<DependentForm />);
    expect(
      screen.getByRole('button', { name: /add dependent/i }),
    ).toBeInTheDocument();
  });

  it('calls onSaved when the underlying Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<DependentForm onSaved={onSaved} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
