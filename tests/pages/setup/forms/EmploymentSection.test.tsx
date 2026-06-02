import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePersonsStore } from '@/stores/persons-store';
import type { Person } from '@/types/schema';
import EmploymentSection from '@/pages/setup/forms/EmploymentSection';

function makePerson(id: number, name: string, patch: Partial<Person> = {}): Person {
  return {
    id,
    householdId: 1,
    name,
    dateOfBirth: '1990-01-01',
    employmentType: 'SALARY_NO_OT',
    annualSalaryPretax: 100000,
    hourlyRate: null,
    regularHoursPerWeek: 40,
    otThresholdHoursPerWeek: null,
    targetRetirementAge: 65,
    targetSocialSecurityAge: 67,
    socialSecurityPiaMonthly: 0,
    jobStability: null,
    expectsHigherFutureIncome: null,
    onParentHealthInsurance: null,
    isRelativelyHealthy: null,
    ...patch,
  };
}

describe('EmploymentSection', () => {
  beforeEach(() => {
    usePersonsStore.setState({
      persons: [makePerson(1, 'Alice')],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update: async () => {},
      remove: async () => {},
    } as any);
  });

  it('renders one card per person with their name and employment fields', () => {
    render(<EmploymentSection />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByLabelText(/employment type/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/annual salary \(pre-tax\)/i),
    ).toBeInTheDocument();
  });

  it('shows an empty-state when no persons exist', () => {
    usePersonsStore.setState({ persons: [] } as any);
    render(<EmploymentSection />);
    expect(
      screen.getByText(/add at least one person first/i),
    ).toBeInTheDocument();
  });

  it('saves an HOURLY person with hourly fields but no annual salary (M1)', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const onSaved = vi.fn();
    usePersonsStore.setState({
      persons: [
        makePerson(1, 'Hank', {
          employmentType: 'HOURLY',
          annualSalaryPretax: 0,
          hourlyRate: 30,
          regularHoursPerWeek: 40,
        }),
      ],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update,
      remove: async () => {},
    } as never);
    const user = userEvent.setup();
    render(<EmploymentSection onSaved={onSaved} />);

    // Reproduce an empty annual-salary draft for an HOURLY worker: flip to a
    // salaried type to reveal the field, clear it, then flip back to HOURLY.
    const typeSelect = screen.getByLabelText(/employment type/i);
    await user.selectOptions(typeSelect, 'SALARY_NO_OT');
    await user.clear(screen.getByLabelText(/annual salary \(pre-tax\)/i));
    await user.selectOptions(typeSelect, 'HOURLY');

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // Save must NOT be blocked on the (irrelevant) empty annual salary.
    expect(update).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
    const patch = update.mock.calls[0][1];
    expect(patch.employmentType).toBe('HOURLY');
    expect(patch.hourlyRate).toBe(30);
    // No misleading non-zero salary persisted.
    expect(patch.annualSalaryPretax).toBe(0);
    // And no validation error surfaced.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('blocks an HOURLY save that is missing hourly rate (M1)', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    usePersonsStore.setState({
      persons: [
        makePerson(1, 'Hank', {
          employmentType: 'HOURLY',
          annualSalaryPretax: 0,
          hourlyRate: 30,
          regularHoursPerWeek: 40,
        }),
      ],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update,
      remove: async () => {},
    } as never);
    const user = userEvent.setup();
    render(<EmploymentSection />);
    await user.clear(screen.getByLabelText(/hourly rate/i));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('fires onSaved after a successful per-person update', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const onSaved = vi.fn();
    usePersonsStore.setState({
      persons: [makePerson(1, 'Alice')],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update,
      remove: async () => {},
    } as any);
    const user = userEvent.setup();
    render(<EmploymentSection onSaved={onSaved} />);
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(update).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });
});
