import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnswerPrompt } from '@/components/interview/AnswerPrompt';

// D-HP9: the control's year list + future-month validation read useLocalToday.
vi.mock('@/lib/use-local-today', () => ({ useLocalToday: () => '2026-08-01' }));

const SPEC = { kind: 'amount-month-year', maxDollars: 10_000_000 } as const;

describe('AnswerPrompt — amount-month-year arm (the T2 kernel-control delta)', () => {
  it('renders MoneyInput + Month/Year native selects + a disabled Save (typed controls only)', () => {
    render(<AnswerPrompt prompt="About how much would the down payment be, and by when?" spec={SPEC} onSubmit={async () => {}} />);
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
    expect(screen.getByLabelText('Month')).toBeInTheDocument();
    expect(screen.getByLabelText('Year')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    // No free text: the only textbox is the MoneyInput.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('year options span the current year through current + 10', () => {
    render(<AnswerPrompt prompt="p" spec={SPEC} onSubmit={async () => {}} />);
    const year = screen.getByLabelText('Year') as HTMLSelectElement;
    const values = [...year.options].map((o) => o.value).filter((v) => v !== '');
    expect(values[0]).toBe('2026');
    expect(values.at(-1)).toBe('2036');
    expect(values).toHaveLength(11);
  });

  it('Save stays disabled for the CURRENT month (a target must be ≥ 1 whole month ahead)', () => {
    render(<AnswerPrompt prompt="p" spec={SPEC} onSubmit={async () => {}} />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '60000' } });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '08' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('a valid amount + future month submits the compound value', async () => {
    const onSubmit = vi.fn(async () => {});
    render(<AnswerPrompt prompt="p" spec={SPEC} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '60000' } });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '06' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2028' } });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ amountDollars: 60000, targetMonth: '2028-06' }));
  });

  it('amounts over maxDollars keep Save disabled', () => {
    render(<AnswerPrompt prompt="p" spec={{ kind: 'amount-month-year', maxDollars: 50_000 }} onSubmit={async () => {}} />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '60000' } });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '06' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2028' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  // Smoke a11y fix: the past/current-month rejection must not be silent —
  // Save stays disabled, and an inline error EXPLAINS it (the house trio:
  // FieldError text + aria-invalid + aria-describedby on the month/year
  // group), cleared once the selection becomes valid.
  it('a past month with an amount entered explains WHY Save is disabled (the aria trio)', () => {
    render(<AnswerPrompt prompt="p" spec={SPEC} onSubmit={async () => {}} />);
    // No amount yet → no error even with a past month selected:
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '01' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } });
    expect(screen.queryByText('Pick a month at least one month ahead.')).toBeNull();
    // Amount entered → the rejection is explained:
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '60000' } });
    const error = screen.getByText('Pick a month at least one month ahead.');
    const month = screen.getByLabelText('Month');
    const year = screen.getByLabelText('Year');
    expect(month).toHaveAttribute('aria-invalid', 'true');
    expect(year).toHaveAttribute('aria-invalid', 'true');
    expect(month.getAttribute('aria-describedby')).toBe(error.id);
    expect(year.getAttribute('aria-describedby')).toBe(error.id);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('the month error clears (trio and all) when the selection becomes valid', () => {
    render(<AnswerPrompt prompt="p" spec={SPEC} onSubmit={async () => {}} />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '60000' } });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '01' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } });
    expect(screen.getByText('Pick a month at least one month ahead.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2028' } });
    expect(screen.queryByText('Pick a month at least one month ahead.')).toBeNull();
    expect(screen.getByLabelText('Month')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Year')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
