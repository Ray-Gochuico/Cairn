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
    // MoneyInput renders a formatted text value (Wave 11 T7).
    expect(screen.getByLabelText(/monthly payment/i)).toHaveValue('566.14');
  });
});

describe('LoanForm percent-entry rate field (Wave 11 T6)', () => {
  function renderForm(initialOver = {}, onSubmit = vi.fn().mockResolvedValue(undefined)) {
    render(
      <LoanForm
        initial={{
          ...DEFAULT_LOAN,
          name: 'Mortgage',
          originalAmount: 300000,
          currentBalance: 250000,
          interestRate: 0.0625,
          termMonths: 360,
          firstPaymentDate: '2024-01-01',
          monthlyPayment: 1800,
          ...initialOver,
        }}
        persons={[{ id: 1, name: 'Alice' }]}
        properties={[]}
        vehicles={[]}
        initialMonthlyPaymentIsUserSet
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    return onSubmit;
  }

  it('displays the stored fraction as a whole percent with a % suffix', () => {
    renderForm();
    expect(screen.getByLabelText(/interest rate/i)).toHaveValue(6.25);
    expect(screen.getByText('%')).toBeInTheDocument();
  });

  it('converts the percent field back to a fraction on submit', async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    const rate = screen.getByLabelText(/interest rate/i);
    await user.clear(rate);
    await user.type(rate, '7');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].interestRate).toBeCloseTo(0.07, 10);
  });

  it('untouched resubmit preserves the exact stored fraction (no 100x drift)', async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].interestRate).toBe(0.0625);
  });

  it('dollar fields use MoneyInput — separators on blur, raw number in the payload (Wave 11 T7)', async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    const original = screen.getByLabelText(/original amount/i) as HTMLInputElement;
    await user.clear(original);
    await user.type(original, '300000');
    await user.tab();
    expect(original.value).toBe('300,000');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit.mock.calls[0][0].originalAmount).toBe(300000);
  });
});
