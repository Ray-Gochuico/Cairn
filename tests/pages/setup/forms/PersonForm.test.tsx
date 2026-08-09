import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePersonsStore } from '@/stores/persons-store';
import PersonForm from '@/pages/setup/forms/PersonForm';
import PersonFormImpl, { DEFAULT_PERSON } from '@/components/forms/PersonForm';

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

  it('switching an existing salaried person to Hourly submits annualSalaryPretax 0', async () => {
    // The shared employment contract (worded-onboarding Task 2): PersonForm
    // used to silently keep the stale hidden salary; EmploymentSection zeroed
    // it. One contract now — HOURLY persists 0, always.
    const onSubmit = vi.fn(async () => {});
    render(<PersonFormImpl
      initial={{ ...DEFAULT_PERSON, name: 'Alex', dateOfBirth: '1990-01-01', annualSalaryPretax: 90000 }}
      onSubmit={onSubmit}
    />);
    await userEvent.selectOptions(screen.getByLabelText(/employment type/i), 'HOURLY');
    await userEvent.type(screen.getByLabelText(/hourly rate/i), '31.25');
    // regular hours prefilled (40); submit
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ employmentType: 'HOURLY', annualSalaryPretax: 0 }),
    );
  });
});
