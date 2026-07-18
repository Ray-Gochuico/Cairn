import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContributionForm, { type ContributionFormValues } from '@/components/forms/ContributionForm';
import { ContributionSource } from '@/types/enums';

const accounts = [
  { id: 1, name: 'Brokerage' },
  { id: 2, name: 'Roth IRA' },
];
const persons = [{ id: 1, name: 'Alice' }];

const initial: ContributionFormValues = {
  accountId: 1,
  personId: null,
  date: '2026-01-15',
  amount: 500,
  source: ContributionSource.PAYCHECK,
};

describe('ContributionForm (extracted, W14)', () => {
  it('renders fields from `initial` with the provided option lists', () => {
    render(
      <ContributionForm
        initial={initial}
        accounts={accounts}
        persons={persons}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Account')).toHaveValue('1');
    expect(screen.getByRole('option', { name: 'Roth IRA' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toHaveValue(500);
  });

  it('submit calls onSubmit with parsed values', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    render(
      <ContributionForm
        initial={initial}
        accounts={accounts}
        persons={persons}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const amount = screen.getByLabelText(/amount/i);
    await user.clear(amount);
    await user.type(amount, '750');
    await user.selectOptions(screen.getByLabelText('Account'), '2');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 2, amount: 750, source: ContributionSource.PAYCHECK }),
    );
  });

  it('an invalid submit shows the form-error summary (role=alert) and inline field error', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <ContributionForm
        initial={{ ...initial, amount: -5 }}
        accounts={accounts}
        persons={persons}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    // Dirty the form (Save stays disabled while pristine — tab behavior kept).
    await user.selectOptions(screen.getByLabelText('Account'), '2');
    await user.click(screen.getByRole('button', { name: /save/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/amount/i);
    const amount = screen.getByLabelText(/amount/i);
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a rejected save lands in the summary, not an unhandled rejection', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {
      throw new Error('disk full');
    });
    render(
      <ContributionForm
        initial={initial}
        accounts={accounts}
        persons={persons}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const amount = screen.getByLabelText(/amount/i);
    await user.clear(amount);
    await user.type(amount, '750');
    await user.click(screen.getByRole('button', { name: /save/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/disk full/i);
  });

  it('Cancel calls onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ContributionForm
        initial={initial}
        accounts={accounts}
        persons={persons}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
