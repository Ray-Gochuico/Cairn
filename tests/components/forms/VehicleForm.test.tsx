import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VehicleForm, { DEFAULT_VEHICLE } from '@/components/forms/VehicleForm';

const persons = [{ id: 1, name: 'Alice' }];

describe('VehicleForm — inline per-field errors (round-3 S6)', () => {
  it('empty name shows an inline humanized error with aria-invalid', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <VehicleForm
        initial={{ ...DEFAULT_VEHICLE, name: '' }}
        persons={persons}
        autoLoans={[]}
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

  it('an out-of-range year gets its own inline error', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <VehicleForm
        initial={{ ...DEFAULT_VEHICLE, name: 'Car' }}
        persons={persons}
        autoLoans={[]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const year = screen.getByLabelText(/^year \(optional\)/i);
    await user.type(year, '1800');
    await user.click(screen.getByRole('button', { name: /save|add/i }));
    expect(year).toHaveAttribute('aria-invalid', 'true');
    expect(year).toHaveAccessibleDescription('Must be at least 1900');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
