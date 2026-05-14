import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PersonForm, {
  DEFAULT_PERSON,
  type PersonFormValues,
} from '@/components/forms/PersonForm';

function makeInitial(overrides: Partial<PersonFormValues> = {}): PersonFormValues {
  return { ...DEFAULT_PERSON, ...overrides };
}

describe('PersonForm — employment type & bonus fields', () => {
  it('shows hourly_rate and ot_threshold_hours when employment_type=HOURLY', async () => {
    render(
      <PersonForm
        initial={makeInitial({ employmentType: 'HOURLY' })}
        onSubmit={async () => {}}
      />,
    );
    expect(screen.getByLabelText(/hourly rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ot threshold/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/annual salary/i)).not.toBeInTheDocument();
  });

  it('hides hourly_rate when employment_type=SALARY_NO_OT', async () => {
    render(
      <PersonForm
        initial={makeInitial({ employmentType: 'SALARY_NO_OT' })}
        onSubmit={async () => {}}
      />,
    );
    expect(screen.queryByLabelText(/hourly rate/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ot threshold/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/annual salary/i)).toBeInTheDocument();
  });

  it('shows both annual salary and hourly rate fields when employment_type=SALARY_WITH_OT', async () => {
    render(
      <PersonForm
        initial={makeInitial({ employmentType: 'SALARY_WITH_OT' })}
        onSubmit={async () => {}}
      />,
    );
    expect(screen.getByLabelText(/annual salary/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/hourly rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ot threshold/i)).toBeInTheDocument();
  });

  it('shows bonus frequency dropdown and consistency checkbox', async () => {
    render(
      <PersonForm initial={makeInitial()} onSubmit={async () => {}} />,
    );
    expect(screen.getByLabelText(/bonus frequency/i)).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /bonuses are consistent/i }),
    ).toBeInTheDocument();
  });

  it('switching from SALARY_NO_OT to HOURLY reveals hourly fields and hides annual salary', async () => {
    const user = userEvent.setup();
    render(
      <PersonForm initial={makeInitial()} onSubmit={async () => {}} />,
    );

    // Default is SALARY_NO_OT — annual salary visible, hourly hidden.
    expect(screen.getByLabelText(/annual salary/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/hourly rate/i)).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText(/employment type/i),
      'HOURLY',
    );

    expect(screen.queryByLabelText(/annual salary/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/hourly rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ot threshold/i)).toBeInTheDocument();
  });
});
