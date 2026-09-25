import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnswerPrompt } from '@/components/interview/AnswerPrompt';

// D-HP9: the control's year list + future-month validation read useLocalToday.
vi.mock('@/lib/use-local-today', () => ({ useLocalToday: () => '2026-08-01' }));

const SPEC = { kind: 'amount-month-year', maxDollars: 10_000_000 } as const;

describe('AnswerPrompt — amount-month-year arm (the T2 kernel-control delta)', () => {
  it('renders MoneyInput + Month/Year native selects + a disabled Save (typed controls only)', () => {
    render(<AnswerPrompt prompt="About how much would the down payment be, and by when?" spec={SPEC} onSubmit={async () => {}} />);
    expect(screen.getByLabelText(/^Amount/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Month/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Year/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    // No free text: the only textbox is the MoneyInput.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('year options span the current year through current + 10', () => {
    render(<AnswerPrompt prompt="p" spec={SPEC} onSubmit={async () => {}} />);
    const year = screen.getByLabelText(/^Year/) as HTMLSelectElement;
    const values = [...year.options].map((o) => o.value).filter((v) => v !== '');
    expect(values[0]).toBe('2026');
    expect(values.at(-1)).toBe('2036');
    expect(values).toHaveLength(11);
  });

  it('Save stays disabled for the CURRENT month (a target must be ≥ 1 whole month ahead)', () => {
    render(<AnswerPrompt prompt="p" spec={SPEC} onSubmit={async () => {}} />);
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '60000' } });
    fireEvent.change(screen.getByLabelText(/^Month/), { target: { value: '08' } });
    fireEvent.change(screen.getByLabelText(/^Year/), { target: { value: '2026' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('a valid amount + future month submits the compound value', async () => {
    const onSubmit = vi.fn(async () => {});
    render(<AnswerPrompt prompt="p" spec={SPEC} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '60000' } });
    fireEvent.change(screen.getByLabelText(/^Month/), { target: { value: '06' } });
    fireEvent.change(screen.getByLabelText(/^Year/), { target: { value: '2028' } });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ amountDollars: 60000, targetMonth: '2028-06' }));
  });

  it('amounts over maxDollars keep Save disabled', () => {
    render(<AnswerPrompt prompt="p" spec={{ kind: 'amount-month-year', maxDollars: 50_000 }} onSubmit={async () => {}} />);
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '60000' } });
    fireEvent.change(screen.getByLabelText(/^Month/), { target: { value: '06' } });
    fireEvent.change(screen.getByLabelText(/^Year/), { target: { value: '2028' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  // Smoke a11y fix: the past/current-month rejection must not be silent —
  // Save stays disabled, and an inline error EXPLAINS it (the house trio:
  // FieldError text + aria-invalid + aria-describedby on the month/year
  // group), cleared once the selection becomes valid.
  it('a past month with an amount entered explains WHY Save is disabled (the aria trio)', () => {
    render(<AnswerPrompt prompt="p" spec={SPEC} onSubmit={async () => {}} />);
    // No amount yet → no error even with a past month selected:
    fireEvent.change(screen.getByLabelText(/^Month/), { target: { value: '01' } });
    fireEvent.change(screen.getByLabelText(/^Year/), { target: { value: '2026' } });
    expect(screen.queryByText('Pick a month at least one month ahead.')).toBeNull();
    // Amount entered → the rejection is explained:
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '60000' } });
    const error = screen.getByText('Pick a month at least one month ahead.');
    const month = screen.getByLabelText(/^Month/);
    const year = screen.getByLabelText(/^Year/);
    expect(month).toHaveAttribute('aria-invalid', 'true');
    expect(year).toHaveAttribute('aria-invalid', 'true');
    expect(month.getAttribute('aria-describedby')).toBe(error.id);
    expect(year.getAttribute('aria-describedby')).toBe(error.id);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('the month error clears (trio and all) when the selection becomes valid', () => {
    render(<AnswerPrompt prompt="p" spec={SPEC} onSubmit={async () => {}} />);
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '60000' } });
    fireEvent.change(screen.getByLabelText(/^Month/), { target: { value: '01' } });
    fireEvent.change(screen.getByLabelText(/^Year/), { target: { value: '2026' } });
    expect(screen.getByText('Pick a month at least one month ahead.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Year/), { target: { value: '2028' } });
    expect(screen.queryByText('Pick a month at least one month ahead.')).toBeNull();
    expect(screen.getByLabelText(/^Month/)).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText(/^Year/)).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

const MY_SPEC = { kind: 'month-year' } as const;
const COLLEGE_SPEC = { kind: 'month-year', minMonthsAhead: 0, maxYearsAhead: 19 } as const;

describe('AnswerPrompt — month-year arm (R4 D-R4-1)', () => {
  it('CR-MY-1: Month/Year selects + a disabled Save; no amount, no textbox', () => {
    render(<AnswerPrompt prompt="When would college costs start?" spec={MY_SPEC} onSubmit={async () => {}} />);
    expect(screen.getByLabelText('Month — When would college costs start?')).toBeInTheDocument();
    expect(screen.getByLabelText('Year — When would college costs start?')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Amount/)).toBeNull();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('year list: the default cap gives 11 entries (2026…2036); maxYearsAhead 19 gives 20 (2026…2045)', () => {
    const { unmount } = render(<AnswerPrompt prompt="p" spec={MY_SPEC} onSubmit={async () => {}} />);
    const years = () => [...(screen.getByLabelText(/^Year/) as HTMLSelectElement).options].map((o) => o.value).filter((v) => v !== '');
    expect(years()).toHaveLength(11);
    expect(years().at(-1)).toBe('2036');
    unmount();
    render(<AnswerPrompt prompt="p" spec={COLLEGE_SPEC} onSubmit={async () => {}} />);
    expect(years()).toHaveLength(20);
    expect(years()[0]).toBe('2026');
    expect(years().at(-1)).toBe('2045');
  });

  it('default minMonthsAhead 1: the current month keeps Save disabled and explains with CR-MY-2 + the aria trio', () => {
    render(<AnswerPrompt prompt="p" spec={MY_SPEC} onSubmit={async () => {}} />);
    fireEvent.change(screen.getByLabelText(/^Month/), { target: { value: '08' } });
    fireEvent.change(screen.getByLabelText(/^Year/), { target: { value: '2026' } });
    const error = screen.getByText('Pick a month at least one month ahead.');
    expect(screen.getByLabelText(/^Month/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^Year/).getAttribute('aria-describedby')).toBe(error.id);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('minMonthsAhead 0 (college): the current month submits the bare YYYY-MM; a past month explains with CR-MY-3', async () => {
    const onSubmit = vi.fn(async () => {});
    render(<AnswerPrompt prompt="p" spec={COLLEGE_SPEC} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/^Month/), { target: { value: '07' } });
    fireEvent.change(screen.getByLabelText(/^Year/), { target: { value: '2026' } });
    expect(screen.getByText('Pick this month or a later one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Month/), { target: { value: '08' } });
    expect(screen.queryByText('Pick this month or a later one.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('2026-08'));
  });

  it('a future month submits the bare string, never an object', async () => {
    const onSubmit = vi.fn(async () => {});
    render(<AnswerPrompt prompt="p" spec={MY_SPEC} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/^Month/), { target: { value: '06' } });
    fireEvent.change(screen.getByLabelText(/^Year/), { target: { value: '2028' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('2028-06'));
  });
});

describe('CR-AP-1 — every control is named by its noun AND the prompt (no two "Amount"s on a page)', () => {
  it('compound arm', () => {
    render(<AnswerPrompt prompt="About how much would the down payment be, and by when?" spec={SPEC} onSubmit={async () => {}} />);
    for (const noun of ['Amount', 'Month', 'Year']) {
      expect(screen.getByLabelText(`${noun} — About how much would the down payment be, and by when?`)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Amount')).toBeNull(); // exact bare name is gone
  });
  it('amount arm', () => {
    render(<AnswerPrompt prompt="About how much goes toward college savings each month?" spec={{ kind: 'amount', maxDollars: 50_000 }} onSubmit={async () => {}} />);
    expect(screen.getByLabelText('Amount — About how much goes toward college savings each month?')).toBeInTheDocument();
  });
});
