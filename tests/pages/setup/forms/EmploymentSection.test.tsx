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
