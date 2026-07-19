import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EarnerSelect } from '@/components/calculators/EarnerSelect';
import type { Person } from '@/types/schema';

function makePerson(id: number, name: string): Person {
  return {
    id,
    householdId: 1,
    name,
    dateOfBirth: '1990-01-15',
    targetRetirementAge: 65,
    annualSalaryPretax: 100_000,
    expectedBonus: 0,
    expectedBonusFrequency: 'ANNUAL',
    bonusIsConsistent: true,
    expectedCommission: 0,
    expectedCommissionFrequency: 'MONTHLY',
    employmentType: 'SALARY_NO_OT',
    hourlyRate: null,
    regularHoursPerWeek: 40,
    otThresholdHoursPerWeek: null,
    pretax401kPct: 0,
    healthInsuranceMonthlyPremium: 0,
    dependentCareFsaMonthly: 0,
    hsaMonthlyContribution: 0,
    hsaEligible: false,
    jobStability: null,
    expectsHigherFutureIncome: null,
    onParentHealthInsurance: null,
    isRelativelyHealthy: null,
  };
}

const alex = makePerson(1, 'Alex');
const brooke = makePerson(2, 'Brooke');

describe('EarnerSelect', () => {
  it('renders nothing with zero persons', () => {
    const { container } = render(
      <EarnerSelect persons={[]} selectedId={null} onChange={() => {}} label="Who" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing with one person', () => {
    const { container } = render(
      <EarnerSelect persons={[alex]} selectedId={1} onChange={() => {}} label="Who" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a role=group with one aria-pressed button per person at 2+', () => {
    render(
      <EarnerSelect
        persons={[alex, brooke]}
        selectedId={1}
        onChange={() => {}}
        label="Who receives this bonus"
      />,
    );
    const group = screen.getByRole('group', { name: 'Who receives this bonus' });
    expect(group).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Alex' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Brooke' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a person fires onChange with the person id', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <EarnerSelect persons={[alex, brooke]} selectedId={1} onChange={onChange} label="Who" />,
    );
    await user.click(screen.getByRole('button', { name: 'Brooke' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  describe('includeCombined', () => {
    it('renders a leading Combined segment, pressed when selectedId is null', () => {
      render(
        <EarnerSelect
          persons={[alex, brooke]}
          selectedId={null}
          onChange={() => {}}
          label="View"
          includeCombined
        />,
      );
      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(3);
      expect(buttons[0]).toHaveTextContent('Combined');
      expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Alex' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('clicking Combined fires onChange(null)', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <EarnerSelect
          persons={[alex, brooke]}
          selectedId={1}
          onChange={onChange}
          label="View"
          includeCombined
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Combined' }));
      expect(onChange).toHaveBeenCalledWith(null);
    });
  });
});
