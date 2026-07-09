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

  it('a negative target amount gets its own inline error', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <GoalForm initial={{ ...DEFAULT_GOAL, name: 'Fund' }} persons={persons} accounts={[]} onSubmit={onSubmit} />,
    );
    const amount = screen.getByLabelText(/target amount/i);
    await user.clear(amount);
    await user.type(amount, '-5');
    await user.click(screen.getByRole('button', { name: /save|add/i }));
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(amount).toHaveAccessibleDescription('Must be at least 0');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
