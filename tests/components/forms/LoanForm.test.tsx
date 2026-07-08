import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoanForm, { DEFAULT_LOAN } from '@/components/forms/LoanForm';

describe('LoanForm monthly-payment autofill', () => {
  it('autofills the CONTRACT payment from originalAmount for a seasoned loan (wave-9 F4)', async () => {
    // $30k original @5%/60mo, paid down to $18k. Contract payment = $566.14.
    // Pre-fix the autofill amortized the $18k balance over the full 60 months
    // → $339.68, understating the payment ~40% and corrupting every payoff
    // projection downstream.
    const user = userEvent.setup();
    render(
      <LoanForm
        initial={{
          ...DEFAULT_LOAN,
          name: 'Car loan',
          originalAmount: 30000,
          currentBalance: 18000,
          interestRate: 0.05,
          termMonths: 60,
          firstPaymentDate: '2024-01-01',
        }}
        persons={[{ id: 1, name: 'Alice' }]}
        properties={[]}
        vehicles={[]}
        initialMonthlyPaymentIsUserSet={false}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />,
    );
    // Blur any amortization input to trigger the autofill.
    await user.click(screen.getByLabelText(/current balance/i));
    await user.tab();
    expect(screen.getByLabelText(/monthly payment/i)).toHaveValue(566.14);
  });
});
