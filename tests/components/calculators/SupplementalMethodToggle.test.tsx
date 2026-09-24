import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupplementalMethodToggle } from '@/components/calculators/SupplementalMethodToggle';

describe('SupplementalMethodToggle', () => {
  it('reflects the method via aria-pressed', () => {
    render(<SupplementalMethodToggle method="AGGREGATE" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /aggregate/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /flat/i })).toHaveAttribute('aria-pressed', 'false');
    // B2 review: the group's accessible name (SegmentedControl's `label`) is pinned here, on the consumer.
    expect(screen.getByRole('group', { name: 'Withholding method' })).toContainElement(
      screen.getByRole('button', { name: /aggregate/i }),
    );
  });
  it('calls onChange with the clicked method', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SupplementalMethodToggle method="AGGREGATE" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /flat/i }));
    expect(onChange).toHaveBeenCalledWith('FLAT');
  });
});
