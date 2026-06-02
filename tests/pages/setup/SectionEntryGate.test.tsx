import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SectionEntryGate from '@/pages/setup/SectionEntryGate';

describe('SectionEntryGate', () => {
  it('renders the intro title and body', () => {
    render(
      <SectionEntryGate
        title="Your assets"
        body="This section covers accounts and holdings."
        onStart={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(screen.getByText(/Your assets/)).toBeInTheDocument();
    expect(
      screen.getByText(/This section covers accounts and holdings./),
    ).toBeInTheDocument();
  });

  it('calls onStart when "Start this section" is clicked', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(
      <SectionEntryGate
        title="t"
        body="b"
        onStart={onStart}
        onSkip={() => {}}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: /start this section/i }),
    );
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('calls onSkip when "Skip" is clicked', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(
      <SectionEntryGate
        title="t"
        body="b"
        onStart={() => {}}
        onSkip={onSkip}
      />,
    );
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('shows the "you skipped earlier" hint when wasSkipped=true', () => {
    render(
      <SectionEntryGate
        title="t"
        body="b"
        onStart={() => {}}
        onSkip={() => {}}
        wasSkipped
      />,
    );
    expect(
      screen.getByText(/you skipped this section earlier/i),
    ).toBeInTheDocument();
  });

  it('wraps the wasSkipped hint in the standard warning chip (M3: not bare text)', () => {
    render(
      <SectionEntryGate
        title="t"
        body="b"
        onStart={() => {}}
        onSkip={() => {}}
        wasSkipped
      />,
    );
    const hint = screen.getByText(/you skipped this section earlier/i);
    // The hint sits inside a warning-soft chip (paired background, not bare
    // amber text on the card surface).
    const chip = hint.closest('[class*="bg-warning-soft"]');
    expect(chip).not.toBeNull();
    expect(chip?.className).toMatch(/border-warning/);
  });
});
