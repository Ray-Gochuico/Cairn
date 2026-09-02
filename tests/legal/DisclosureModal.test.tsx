import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DisclosureModal } from '@/legal/DisclosureModal';

const appWideDoc = {
  id: 'app_wide' as const,
  version: '1.0',
  title: 'Disclaimer',
  body: 'This is the disclosure **body** text.\n\nSecond paragraph.',
  acceptanceCheckboxLabel: 'I have read and understand.',
};

const roadmapDoc = {
  id: 'roadmap' as const,
  version: '1.0',
  title: 'About the Roadmap',
  body: 'Roadmap disclosure body.',
  acceptanceCheckboxLabel: 'I understand the Roadmap is algorithmic.',
};

describe('DisclosureModal', () => {
  it('renders the disclosure body as text', () => {
    render(<DisclosureModal document={appWideDoc} onAccept={vi.fn()} />);
    expect(screen.getByText(/this is the disclosure/i)).toBeInTheDocument();
    expect(screen.getByText(/second paragraph/i)).toBeInTheDocument();
  });

  it('parses Markdown — **bold** source becomes a <strong> element, not literal asterisks', () => {
    render(<DisclosureModal document={appWideDoc} onAccept={vi.fn()} />);
    const body = screen.getByTestId('disclosure-modal-body');
    // The source has `**body**`; after react-markdown, the word "body"
    // lives inside a <strong> element and the asterisks are gone.
    const strong = body.querySelector('strong');
    expect(strong, 'expected a <strong> element from Markdown parsing').not.toBeNull();
    expect(strong!.textContent).toMatch(/body/i);
    // The literal asterisks should not appear in the rendered output.
    expect(body.textContent).not.toMatch(/\*\*/);
  });

  it('parses Markdown bullets and renders them inside a <ul>', () => {
    const bulletedDoc = {
      ...appWideDoc,
      body: 'Intro.\n\n- first point\n- second point\n',
    };
    render(<DisclosureModal document={bulletedDoc} onAccept={vi.fn()} />);
    const body = screen.getByTestId('disclosure-modal-body');
    expect(body.querySelector('ul')).not.toBeNull();
    expect(body.querySelectorAll('li').length).toBe(2);
  });

  it('uses "Disclaimer" as the title for app_wide', () => {
    render(<DisclosureModal document={appWideDoc} onAccept={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Disclaimer' })).toBeInTheDocument();
  });

  it('uses "About the Roadmap" as the title for roadmap', () => {
    render(<DisclosureModal document={roadmapDoc} onAccept={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'About the Roadmap' })).toBeInTheDocument();
  });

  it('shows the version number', () => {
    render(<DisclosureModal document={appWideDoc} onAccept={vi.fn()} />);
    expect(screen.getByText(/version 1\.0/i)).toBeInTheDocument();
  });

  it('disables Continue until the checkbox is checked', () => {
    render(<DisclosureModal document={appWideDoc} onAccept={vi.fn()} />);
    const button = screen.getByRole('button', { name: /continue/i });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button).toBeEnabled();
  });

  it('calls onAccept(version) when Continue is clicked', async () => {
    const onAccept = vi.fn();
    render(<DisclosureModal document={appWideDoc} onAccept={onAccept} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onAccept).toHaveBeenCalledWith('1.0');
  });

  it('does NOT render Cancel when onCancel is omitted', () => {
    render(<DisclosureModal document={appWideDoc} onAccept={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
  });

  it('renders Cancel and wires it when onCancel is provided', () => {
    const onCancel = vi.fn();
    render(<DisclosureModal document={appWideDoc} onAccept={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders a "what changed" section when diffFromPrevious is provided', () => {
    const updated = {
      ...appWideDoc,
      diffFromPrevious: '- Added the pro-rata caveat for backdoor Roth.',
    };
    render(<DisclosureModal document={updated} onAccept={vi.fn()} />);
    expect(screen.getByText(/what changed since you last accepted/i)).toBeInTheDocument();
    expect(screen.getByText(/added the pro-rata caveat/i)).toBeInTheDocument();
  });

  it('honours the custom continueLabel', () => {
    render(
      <DisclosureModal document={appWideDoc} onAccept={vi.fn()} continueLabel="Continue to setup" />,
    );
    expect(
      screen.getByRole('button', { name: 'Continue to setup' }),
    ).toBeInTheDocument();
  });

  it('renders the supplied acceptance checkbox label', () => {
    render(<DisclosureModal document={appWideDoc} onAccept={vi.fn()} />);
    expect(screen.getByText('I have read and understand.')).toBeInTheDocument();
  });

  it('shows an inline error and re-enables Continue if onAccept rejects', async () => {
    const onAccept = vi.fn().mockRejectedValue(new Error('db unavailable'));
    render(<DisclosureModal document={appWideDoc} onAccept={onAccept} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/db unavailable/i);
    // Continue button should be enabled again so the user can retry.
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('R14: renders inside a Radix Dialog (data-state=open + role=dialog)', () => {
    // Confirms the migration from hand-rolled <div role="dialog"> to
    // @radix-ui/react-dialog. The Radix primitive surfaces role="dialog"
    // on the Content element and data-state="open" while mounted. Focus
    // trap + aria-modal handling are tested implicitly by the Radix
    // primitive's own test suite — the integration test here just
    // pins that we're using the primitive.
    render(<DisclosureModal document={appWideDoc} onAccept={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog.getAttribute('data-state')).toBe('open');
    // Radix emits aria-modal on the Content (or on a focus-guard sibling
    // depending on version). Either way the dialog has labeled itself —
    // the title element is reachable and labels the dialog.
    expect(screen.getByRole('heading', { name: /disclaimer/i })).toBeInTheDocument();
  });

  describe('secondaryAction (W4 explore entry)', () => {
    const action = () => ({
      label: 'Explore with sample data first',
      helper: 'See a filled-in Cairn before entering your own numbers.',
      busyLabel: 'Opening sample data…',
      onSelect: vi.fn().mockResolvedValue(undefined),
    });

    it('renders nothing without the prop (the AppDisclaimerGate surface is untouched)', () => {
      render(<DisclosureModal document={appWideDoc} onAccept={vi.fn()} />);
      expect(screen.queryByText('Explore with sample data first')).toBeNull();
    });

    it('renders label + helper, disabled until the attestation is checked', () => {
      const a = action();
      render(<DisclosureModal document={appWideDoc} onAccept={vi.fn()} secondaryAction={a} />);
      const btn = screen.getByRole('button', { name: 'Explore with sample data first' });
      expect(btn).toBeDisabled();
      expect(
        screen.getByText('See a filled-in Cairn before entering your own numbers.'),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('checkbox'));
      expect(btn).toBeEnabled();
      fireEvent.click(btn);
      expect(a.onSelect).toHaveBeenCalledTimes(1);
    });

    it('while in flight: shows the busy label and disables BOTH controls', async () => {
      let release!: () => void;
      const a = action();
      a.onSelect = vi.fn().mockImplementation(() => new Promise<void>((r) => (release = r)));
      render(
        <DisclosureModal
          document={appWideDoc}
          onAccept={vi.fn()}
          continueLabel="Continue to setup"
          secondaryAction={a}
        />,
      );
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: 'Explore with sample data first' }));
      expect(await screen.findByRole('button', { name: 'Opening sample data…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Continue to setup' })).toBeDisabled();
      release();
    });

    // W4 review (MINOR 5): SE-C8 is THE failure line for this action, for
    // EVERY rejection shape. The e.message branch made it nearly unreachable
    // — sql.js, the household store and the repo wrappers all throw Error, so
    // in practice the user saw a raw technical string ('db down') in the
    // inline slot instead of the contract copy. Only the primary Continue
    // action still surfaces its own message (a legal write the user retries).
    it('an Error rejection shows the contract failure line, never the raw message (SE-C8)', async () => {
      const a = action();
      a.onSelect = vi.fn().mockRejectedValue(new Error('boom'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(<DisclosureModal document={appWideDoc} onAccept={vi.fn()} secondaryAction={a} />);
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: 'Explore with sample data first' }));
      expect(
        await screen.findByText('Failed to open sample data. Please try again.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('boom')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Explore with sample data first' }),
      ).toBeEnabled();
      expect(warn).toHaveBeenCalled(); // the cause is still logged for support
      warn.mockRestore();
    });

    it('a non-Error rejection shows the same contract failure line (SE-C8)', async () => {
      const a = action();
      a.onSelect = vi.fn().mockRejectedValue('opaque');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(<DisclosureModal document={appWideDoc} onAccept={vi.fn()} secondaryAction={a} />);
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: 'Explore with sample data first' }));
      expect(
        await screen.findByText('Failed to open sample data. Please try again.'),
      ).toBeInTheDocument();
      warn.mockRestore();
    });
  });
});
