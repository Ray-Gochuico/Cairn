import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PropertyForm, { DEFAULT_PROPERTY } from '@/components/forms/PropertyForm';

const persons = [{ id: 1, name: 'Alice' }];

describe('PropertyForm — inline per-field errors (round-3 S6)', () => {
  it('empty name shows an inline humanized error with aria-invalid', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PropertyForm
        initial={{ ...DEFAULT_PROPERTY, name: '' }}
        persons={persons}
        mortgageLoans={[]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /save|add/i }));
    const name = screen.getByLabelText('Name');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Required');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a negative purchase price gets its own inline error', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PropertyForm
        initial={{ ...DEFAULT_PROPERTY, name: 'Home' }}
        persons={persons}
        mortgageLoans={[]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const price = screen.getByLabelText(/purchase price/i);
    await user.type(price, '-5');
    await user.click(screen.getByRole('button', { name: /save|add/i }));
    expect(price).toHaveAttribute('aria-invalid', 'true');
    expect(price).toHaveAccessibleDescription('Must be at least 0');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
