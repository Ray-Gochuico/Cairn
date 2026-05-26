import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SwrLeverPill from '@/components/whatif/SwrLeverPill';

describe('SwrLeverPill', () => {
  it('renders the household default value muted/italic when override is null', () => {
    render(
      <SwrLeverPill
        swrOverride={null}
        householdWithdrawalRate={0.04}
        onChange={() => {}}
      />,
    );
    const input = screen.getByLabelText('SWR percent') as HTMLInputElement;
    expect(input.value).toBe('4.0');
    expect(screen.getByTestId('swr-lever-pill')).toHaveAttribute('data-using-default', 'true');
  });

  it('renders the override value when set', () => {
    render(
      <SwrLeverPill
        swrOverride={0.035}
        householdWithdrawalRate={0.04}
        onChange={() => {}}
      />,
    );
    const input = screen.getByLabelText('SWR percent') as HTMLInputElement;
    expect(input.value).toBe('3.5');
    expect(screen.getByTestId('swr-lever-pill')).toHaveAttribute('data-using-default', 'false');
  });

  it('reset button disabled when override is null', () => {
    render(
      <SwrLeverPill
        swrOverride={null}
        householdWithdrawalRate={0.04}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /reset/i })).toBeDisabled();
  });

  it('reset button enabled when override set; click calls onChange(null)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SwrLeverPill
        swrOverride={0.035}
        householdWithdrawalRate={0.04}
        onChange={onChange}
      />,
    );
    const reset = screen.getByRole('button', { name: /reset/i });
    expect(reset).not.toBeDisabled();
    await user.click(reset);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('typing into the input and blurring calls onChange with the parsed fraction', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SwrLeverPill
        swrOverride={null}
        householdWithdrawalRate={0.04}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText('SWR percent');
    await user.clear(input);
    await user.type(input, '4.5');
    // Commit on blur:
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith(0.045);
  });

  it('rejects values outside 0.5%-15% on blur (no onChange call)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SwrLeverPill
        swrOverride={null}
        householdWithdrawalRate={0.04}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText('SWR percent');
    await user.clear(input);
    await user.type(input, '20'); // 20% → out of range
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
  });
});
