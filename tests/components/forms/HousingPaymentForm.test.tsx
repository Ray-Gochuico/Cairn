import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HousingPaymentForm, { DEFAULT_HOUSING_PAYMENT } from '@/components/forms/HousingPaymentForm';

const persons = [{ id: 1, name: 'Alice' }];

describe('HousingPaymentForm — inline per-field errors (round-3 S6)', () => {
  it('empty name shows an inline humanized error with aria-invalid', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <HousingPaymentForm
        initial={{ ...DEFAULT_HOUSING_PAYMENT, name: '' }}
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
      <HousingPaymentForm
        initial={{
          ...DEFAULT_HOUSING_PAYMENT,
          name: 'Apt rent',
          monthlyAmount: 1800,
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
      selector: '#housing-end-date-error',
    });
    expect(msg).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
