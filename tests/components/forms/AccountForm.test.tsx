import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountForm, { DEFAULT_ACCOUNT } from '@/components/forms/AccountForm';
import { AccountType } from '@/types/enums';

const persons = [{ id: 1, name: 'Alice' }];
const dependents: Array<{ id: number; name: string }> = [];

describe('AccountForm — APY field', () => {
  it('renders the APY input for ACCOUNT_SAVINGS type', () => {
    render(
      <AccountForm
        initial={{ ...DEFAULT_ACCOUNT, type: AccountType.ACCOUNT_SAVINGS, apyRate: null }}
        persons={persons}
        dependents={dependents}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/annual percent yield/i)).toBeInTheDocument();
  });

  it('renders the APY input for ACCOUNT_CASH type', () => {
    render(
      <AccountForm
        initial={{ ...DEFAULT_ACCOUNT, type: AccountType.ACCOUNT_CASH, apyRate: null }}
        persons={persons}
        dependents={dependents}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/annual percent yield/i)).toBeInTheDocument();
  });

  it('does NOT render the APY input for ACCOUNT_BROKERAGE type', () => {
    render(
      <AccountForm
        initial={{ ...DEFAULT_ACCOUNT, type: AccountType.ACCOUNT_BROKERAGE, apyRate: null }}
        persons={persons}
        dependents={dependents}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/annual percent yield/i)).not.toBeInTheDocument();
  });

  it('does NOT render the APY input for ACCOUNT_401K type', () => {
    render(
      <AccountForm
        initial={{ ...DEFAULT_ACCOUNT, type: AccountType.ACCOUNT_401K, apyRate: null }}
        persons={persons}
        dependents={dependents}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/annual percent yield/i)).not.toBeInTheDocument();
  });

  it('typing "4.5" submits apyRate as 0.045', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AccountForm
        initial={{ ...DEFAULT_ACCOUNT, type: AccountType.ACCOUNT_SAVINGS, apyRate: null, name: 'HYSA' }}
        persons={persons}
        dependents={dependents}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const apyInput = screen.getByLabelText(/annual percent yield/i);
    await user.clear(apyInput);
    await user.type(apyInput, '4.5');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.apyRate).toBeCloseTo(0.045, 6);
  });

  it('clearing the APY input submits apyRate as null', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AccountForm
        initial={{ ...DEFAULT_ACCOUNT, type: AccountType.ACCOUNT_SAVINGS, apyRate: 0.04, name: 'HYSA' }}
        persons={persons}
        dependents={dependents}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const apyInput = screen.getByLabelText(/annual percent yield/i);
    await user.clear(apyInput);
    // Make the form dirty by also changing the name
    await user.click(screen.getByRole('button', { name: /save/i }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.apyRate).toBeNull();
  });
});
