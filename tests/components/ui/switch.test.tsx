import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Switch } from '@/components/ui/switch';

describe('Switch primitive', () => {
  it('renders a switch role reflecting checked state', () => {
    render(<Switch checked aria-label="demo" onCheckedChange={() => {}} />);
    const sw = screen.getByRole('switch', { name: 'demo' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('uses the primary token for the on-state (never --success)', () => {
    render(<Switch aria-label="demo" />);
    const sw = screen.getByRole('switch', { name: 'demo' });
    // The on-state background is the app default primary, reserved
    // away from the status-only --success token.
    expect(sw.className).toContain('data-[state=checked]:bg-primary');
    expect(sw.className).not.toContain('success');
  });
});
