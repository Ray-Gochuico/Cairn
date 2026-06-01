import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RealNominalToggle } from '@/components/calculators/RealNominalToggle';

describe('RealNominalToggle', () => {
  it('renders Nominal + Real buttons with aria-pressed reflecting mode', () => {
    render(<RealNominalToggle mode="NOMINAL" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /nominal/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /real/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the clicked mode', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RealNominalToggle mode="NOMINAL" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /real/i }));
    expect(onChange).toHaveBeenCalledWith('REAL');
  });
});
