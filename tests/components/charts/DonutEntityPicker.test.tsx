import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DonutEntityPicker } from '@/components/charts/DonutEntityPicker';

const KEY = 'donut.test.hidden';
const ITEMS = [
  { key: 'a', label: 'Account A', color: '#ff0000' },
  { key: 'b', label: 'Account B', color: '#00ff00' },
  { key: 'c', label: 'Account C', color: '#0000ff' },
];

describe('DonutEntityPicker', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders a button labeled "Included · N of M"', () => {
    render(<DonutEntityPicker localStorageKey={KEY} items={ITEMS} />);
    expect(screen.getByRole('button', { name: /Included · 3 of 3/ })).toBeInTheDocument();
  });

  it('Escape closes the popover and marks the event handled', async () => {
    render(<DonutEntityPicker localStorageKey={KEY} items={ITEMS} />);
    await userEvent.click(screen.getByRole('button', { name: /Included · 3 of 3/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a popover with one row per item', async () => {
    const user = userEvent.setup();
    render(<DonutEntityPicker localStorageKey={KEY} items={ITEMS} />);
    await user.click(screen.getByRole('button', { name: /Included ·/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/Account A/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Account B/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Account C/)).toBeInTheDocument();
  });

  it('toggling a checkbox updates the button count and persists', async () => {
    const user = userEvent.setup();
    render(<DonutEntityPicker localStorageKey={KEY} items={ITEMS} />);
    await user.click(screen.getByRole('button', { name: /Included ·/ }));
    await user.click(screen.getByLabelText(/Account B/));
    expect(
      screen.getByRole('button', { name: /Included · 2 of 3/ }),
    ).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['b']);
  });

  it('Hide all and Show all links work', async () => {
    const user = userEvent.setup();
    render(<DonutEntityPicker localStorageKey={KEY} items={ITEMS} />);
    await user.click(screen.getByRole('button', { name: /Included ·/ }));
    await user.click(screen.getByRole('button', { name: /hide all/i }));
    expect(
      screen.getByRole('button', { name: /Included · 0 of 3/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /show all/i }));
    expect(
      screen.getByRole('button', { name: /Included · 3 of 3/ }),
    ).toBeInTheDocument();
  });

  it('clicking the backdrop closes the popover', async () => {
    const user = userEvent.setup();
    render(<DonutEntityPicker localStorageKey={KEY} items={ITEMS} />);
    await user.click(screen.getByRole('button', { name: /Included ·/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('donut-picker-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not render the button when items is empty', () => {
    render(<DonutEntityPicker localStorageKey={KEY} items={[]} />);
    expect(screen.queryByRole('button', { name: /Included ·/ })).toBeNull();
  });
});
