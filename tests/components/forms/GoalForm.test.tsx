import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GoalForm, { DEFAULT_GOAL } from '@/components/forms/GoalForm';

const persons = [{ id: 1, name: 'Alice' }];

describe('GoalForm — inline per-field errors (round-3 S6)', () => {
  it('empty name shows an inline humanized error with aria-invalid', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <GoalForm initial={{ ...DEFAULT_GOAL, name: '' }} persons={persons} accounts={[]} onSubmit={onSubmit} />,
    );
    await user.click(screen.getByRole('button', { name: /save|add/i }));
    const name = screen.getByLabelText('Name');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Required');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('an invalid target amount gets its own inline error', async () => {
    // MoneyInput strips a typed '-' (round-3 E6), so drive the invalid value
    // through the initial payload — the trio must still wire through
    // MoneyInput's ...rest spread.
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <GoalForm
        initial={{ ...DEFAULT_GOAL, name: 'Fund', targetAmount: -5 }}
        persons={persons}
        accounts={[]}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByRole('button', { name: /save|add/i }));
    const amount = screen.getByLabelText(/target amount/i);
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(amount).toHaveAccessibleDescription('Must be at least 0');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('GoalForm — MoneyInput adoption (round-3 E6)', () => {
  it('the target amount formats with the house MoneyInput', async () => {
    const user = userEvent.setup();
    render(
      <GoalForm initial={{ ...DEFAULT_GOAL, name: 'Fund' }} persons={persons} accounts={[]} onSubmit={vi.fn()} />,
    );
    const input = screen.getByLabelText(/target amount/i);
    await user.clear(input);
    await user.type(input, '25000');
    await user.tab();
    expect(input).toHaveValue('25,000');
    expect(input).toHaveAttribute('inputmode', 'decimal');
  });
});
