import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VehicleLeaseForm, { DEFAULT_VEHICLE_LEASE } from '@/components/forms/VehicleLeaseForm';

const persons = [{ id: 1, name: 'Alice' }];

describe('VehicleLeaseForm — inline per-field errors (round-3 S6)', () => {
  it('empty name shows an inline humanized error with aria-invalid', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <VehicleLeaseForm
        initial={{ ...DEFAULT_VEHICLE_LEASE, name: '' }}
        persons={persons}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /save|add/i }));
    const name = screen.getByLabelText('Label');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Required');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('the end-date refine lands inline on the End date group', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <VehicleLeaseForm
        initial={{
          ...DEFAULT_VEHICLE_LEASE,
          name: 'Tesla lease',
          monthlyAmount: 500,
          startDate: '2026-06-01',
          endDate: '2026-01-01',
        }}
        persons={persons}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /save|add/i }));
    const msg = await screen.findByText('End date must be on or after start date', {
      selector: '#lease-end-date-error',
    });
    expect(msg).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
