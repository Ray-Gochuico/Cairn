import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePersonsStore } from '@/stores/persons-store';
import PersonForm from '@/pages/setup/forms/PersonForm';

describe('Wizard PersonForm (adapter)', () => {
  beforeEach(() => {
    usePersonsStore.setState({
      persons: [],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update: async () => {},
      remove: async () => {},
    } as any);
  });

  it('renders the underlying person form fields', () => {
    render(<PersonForm />);
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /date of birth/i })).toBeInTheDocument();
  });

  it('renders an Add Person submit button', () => {
    render(<PersonForm />);
    expect(
      screen.getByRole('button', { name: /add person/i }),
    ).toBeInTheDocument();
  });

  it('calls onSaved when the underlying Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<PersonForm onSaved={onSaved} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
