import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { getGlossaryEntry } from '@/lib/glossary';

describe('TermTooltip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the visible label and a small ⓘ affordance', () => {
    render(<TermTooltip term="DCFSA" />);
    // Default child is the entry's `term`.
    expect(screen.getByRole('button', { name: /DCFSA/ })).toBeInTheDocument();
  });

  it('opens a popover whose content matches the glossary entry on click', async () => {
    const user = userEvent.setup();
    render(<TermTooltip term="DCFSA" />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /DCFSA/ }));

    const tooltip = await screen.findByRole('tooltip');
    const expected = getGlossaryEntry('DCFSA');
    expect(expected).not.toBeNull();
    expect(tooltip).toHaveTextContent(expected!.shortDefinition);
  });

  it('shows the popover on hover and hides it on mouse leave', async () => {
    const user = userEvent.setup();
    render(<TermTooltip term="SWR" />);
    const trigger = screen.getByRole('button', { name: /SWR/ });

    await user.hover(trigger);
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();

    await user.unhover(trigger);
    // The Radix-backed implementation debounces hover-out by ~120 ms so
    // the user can move the cursor into the popover without it closing
    // prematurely. Wait for the eventual dismissal.
    await waitFor(() =>
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument(),
    );
  });

  it('accepts a child to render alongside the lookup key (e.g., a custom label)', () => {
    render(<TermTooltip term="COAST FI">Coast FI</TermTooltip>);
    expect(screen.getByRole('button', { name: /Coast FI/ })).toBeInTheDocument();
  });

  it('warns in dev for an unknown term and falls back to plain text', () => {
    const originalDev = import.meta.env.DEV;
    // import.meta.env is read-only in some bundlers; guard.
    try {
      (import.meta.env as Record<string, unknown>).DEV = true;
    } catch {
      /* ignore */
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<TermTooltip term="DOES_NOT_EXIST">Custom label</TermTooltip>);
    // No tooltip trigger button — no glossary entry, so the wrapper is inert.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Custom label')).toBeInTheDocument();
    if (originalDev) {
      expect(warn).toHaveBeenCalled();
    }
  });
});
