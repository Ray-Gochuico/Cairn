import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from '@/components/ui/checkbox';

describe('Checkbox (Radix) interaction', () => {
  it('renders with role="checkbox" and toggles on click, firing onCheckedChange', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(<Checkbox aria-label="Agree" onCheckedChange={onCheckedChange} />);

    const box = screen.getByRole('checkbox', { name: 'Agree' });
    expect(box).not.toBeChecked();

    await user.click(box);

    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(box).toBeChecked();
  });

  it('respects a controlled checked prop and the disabled prop', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    const { rerender } = render(
      <Checkbox aria-label="Agree" checked disabled onCheckedChange={onCheckedChange} />,
    );

    const box = screen.getByRole('checkbox', { name: 'Agree' });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();

    await user.click(box);
    expect(onCheckedChange).not.toHaveBeenCalled(); // disabled blocks the toggle

    rerender(<Checkbox aria-label="Agree" checked={false} onCheckedChange={onCheckedChange} />);
    expect(screen.getByRole('checkbox', { name: 'Agree' })).not.toBeChecked();
  });
});
