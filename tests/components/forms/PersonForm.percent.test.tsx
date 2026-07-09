import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PersonForm, {
  DEFAULT_PERSON,
  type PersonFormValues,
} from '@/components/forms/PersonForm';

/**
 * Regression cover for the silent-1000% trap. PersonForm used to ask
 * for the 401(k) deferral as a 0..1 fraction with a "(e.g. 0.10 = 10%)"
 * hint. Non-financial friends entered `10` for 10%, app silently stored
 * 1000%. Fix: input is now percent in 0..100 with a % suffix; the form
 * converts ÷100 at the data boundary so storage stays as the existing
 * fraction (no migration).
 */
function makeInitial(overrides: Partial<PersonFormValues> = {}): PersonFormValues {
  return {
    ...DEFAULT_PERSON,
    // Keep all the validation-blocking required fields filled so the
    // form submits without unrelated errors.
    name: 'Alice',
    dateOfBirth: '1990-01-01',
    annualSalaryPretax: 100000,
    ...overrides,
  };
}

async function submitForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /save/i }));
}

describe('PersonForm — pretax 401(k) percent input', () => {
  it('renders the percent input with a % suffix (not the 0.10=10% fraction hint)', () => {
    render(<PersonForm initial={makeInitial()} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // Label no longer carries the (e.g. 0.10 = 10%) hint.
    expect(
      screen.queryByText(/0\.10 = 10%/i),
    ).not.toBeInTheDocument();
    // A % indicator is rendered alongside the input.
    expect(screen.getByText('%')).toBeInTheDocument();
  });

  it('stores 0.10 in the data layer when the user enters 10', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PersonForm initial={makeInitial()} onSubmit={onSubmit} onCancel={vi.fn()} />);

    const input = screen.getByLabelText(/pre-tax 401\(k\) contribution percent/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '10');
    await submitForm(user);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].pretax401kPct).toBeCloseTo(0.10, 6);
  });

  it('stores 1.0 in the data layer when the user enters 100', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PersonForm initial={makeInitial()} onSubmit={onSubmit} onCancel={vi.fn()} />);

    const input = screen.getByLabelText(/pre-tax 401\(k\) contribution percent/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '100');
    await submitForm(user);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].pretax401kPct).toBeCloseTo(1.0, 6);
  });

  it('stores 0 when the user enters 0', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PersonForm initial={makeInitial()} onSubmit={onSubmit} onCancel={vi.fn()} />);

    const input = screen.getByLabelText(/pre-tax 401\(k\) contribution percent/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '0');
    await submitForm(user);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].pretax401kPct).toBe(0);
  });

  it('stores 0.075 in the data layer when the user enters 7.5 (decimal precision)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PersonForm initial={makeInitial()} onSubmit={onSubmit} onCancel={vi.fn()} />);

    const input = screen.getByLabelText(/pre-tax 401\(k\) contribution percent/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '7.5');
    await submitForm(user);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].pretax401kPct).toBeCloseTo(0.075, 6);
  });

  it('shows a validation error and blocks submit when the user enters 150', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PersonForm initial={makeInitial()} onSubmit={onSubmit} onCancel={vi.fn()} />);

    const input = screen.getByLabelText(/pre-tax 401\(k\) contribution percent/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '150');
    await submitForm(user);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/pretax401k pct percent/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a validation error and blocks submit when the user enters -5', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PersonForm initial={makeInitial()} onSubmit={onSubmit} onCancel={vi.fn()} />);

    const input = screen.getByLabelText(/pre-tax 401\(k\) contribution percent/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '-5');
    await submitForm(user);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/pretax401k pct percent/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('round-trips: a person stored with 0.10 shows 10 in the input', () => {
    render(
      <PersonForm
        initial={makeInitial({ pretax401kPct: 0.10 })}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(/pre-tax 401\(k\) contribution percent/i) as HTMLInputElement;
    // RHF reflects defaultValues onto the DOM; expect the percent
    // representation (10), not the stored fraction (0.10).
    expect(input.value).toBe('10');
  });

  it('round-trips: a person stored with 0.075 shows 7.5 in the input', () => {
    render(
      <PersonForm
        initial={makeInitial({ pretax401kPct: 0.075 })}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(/pre-tax 401\(k\) contribution percent/i) as HTMLInputElement;
    expect(input.value).toBe('7.5');
  });

  it('round-trips: load 0.10 → no edits → submit → fraction unchanged', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <PersonForm
        initial={makeInitial({ pretax401kPct: 0.10 })}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await submitForm(user);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].pretax401kPct).toBeCloseTo(0.10, 6);
  });
});
