import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LeverPopoverShell from '@/components/whatif/levers/LeverPopoverShell';

describe('LeverPopoverShell', () => {
  it('does not render when open is false', () => {
    render(<MemoryRouter><LeverPopoverShell open={false} title="X" onOpenChange={() => {}} onApply={() => {}} onReset={() => {}}>body</LeverPopoverShell></MemoryRouter>);
    expect(screen.queryByText('body')).not.toBeInTheDocument();
  });

  it('renders title and body when open', () => {
    render(<MemoryRouter><LeverPopoverShell open title="Loans" onOpenChange={() => {}} onApply={() => {}} onReset={() => {}}>body content</LeverPopoverShell></MemoryRouter>);
    expect(screen.getByText('Loans')).toBeInTheDocument();
    expect(screen.getByText('body content')).toBeInTheDocument();
  });

  it('clicking Apply fires onApply', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<MemoryRouter><LeverPopoverShell open title="X" onOpenChange={() => {}} onApply={onApply} onReset={() => {}}>x</LeverPopoverShell></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /apply/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('clicking Reset fires onReset without closing', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const onOpenChange = vi.fn();
    render(<MemoryRouter><LeverPopoverShell open title="X" onOpenChange={onOpenChange} onApply={() => {}} onReset={onReset}>x</LeverPopoverShell></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /reset/i }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('clicking Cancel calls onOpenChange(false)', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<MemoryRouter><LeverPopoverShell open title="X" onOpenChange={onOpenChange} onApply={() => {}} onReset={() => {}}>x</LeverPopoverShell></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('disables Apply when applyDisabled=true', () => {
    render(<MemoryRouter><LeverPopoverShell open title="X" onOpenChange={() => {}} onApply={() => {}} onReset={() => {}} applyDisabled>x</LeverPopoverShell></MemoryRouter>);
    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled();
  });
});
