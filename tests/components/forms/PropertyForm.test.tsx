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

  it('an invalid purchase price gets its own inline error', async () => {
    // MoneyInput strips a typed '-' (round-3 E6), so drive the invalid value
    // through the initial payload — the trio must still wire through
    // MoneyInput's ...rest spread.
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PropertyForm
        initial={{ ...DEFAULT_PROPERTY, name: 'Home', purchasePrice: -5 }}
        persons={persons}
        mortgageLoans={[]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /save|add/i }));
    const price = screen.getByLabelText(/purchase price/i);
    expect(price).toHaveAttribute('aria-invalid', 'true');
    expect(price).toHaveAccessibleDescription('Must be at least 0');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('PropertyForm — MoneyInput adoption (round-3 E6)', () => {
  it('money fields format with the house MoneyInput', async () => {
    const user = userEvent.setup();
    render(
      <PropertyForm
        initial={{ ...DEFAULT_PROPERTY, name: 'Home' }}
        persons={persons}
        mortgageLoans={[]}
        onSubmit={vi.fn(async () => {})}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(/purchase price/i);
    await user.type(input, '300000');
    await user.tab();
    expect(input).toHaveValue('300,000'); // text input, formatted on blur
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByLabelText(/current estimated value/i)).toHaveAttribute('inputmode', 'decimal');
  });

  it('MoneyInput submits the raw number, not the formatted string', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    render(
      <PropertyForm
        initial={{ ...DEFAULT_PROPERTY, name: 'Home' }}
        persons={persons}
        mortgageLoans={[]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText(/purchase price/i), '300000');
    await user.click(screen.getByRole('button', { name: /save|add/i }));
    expect(onSubmit).toHaveBeenCalled();
    expect(onSubmit.mock.calls[0][0].purchasePrice).toBe(300000);
  });
});
