import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Step0Disclaimer from '@/pages/setup/Step0Disclaimer';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import * as exploreTransitions from '@/lib/explore-transitions';
import type { Person } from '@/types/schema';

describe('Step0Disclaimer', () => {
  beforeEach(() => {
    // Stub acceptDisclaimer so the test doesn't touch the DB layer.
    useHouseholdStore.setState({
      household: null,
      isLoading: false,
      error: null,
    });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    localStorage.clear();
  });

  it('renders the app_wide disclaimer modal', () => {
    render(<Step0Disclaimer onComplete={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Disclaimer' })).toBeInTheDocument();
    expect(screen.getByText(/version 1\.5/i)).toBeInTheDocument();
  });

  it('T23: shows the branded Welcome-to-Cairn frame above the disclaimer', () => {
    render(<Step0Disclaimer onComplete={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /welcome to cairn/i })).toBeInTheDocument();
    expect(screen.getByText(/a local-first financial planner/i)).toBeInTheDocument();
    // The full versioned disclaimer body + checkbox are still present.
    expect(screen.getByRole('heading', { name: 'Disclaimer' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('disables Continue until the checkbox is checked', () => {
    render(<Step0Disclaimer onComplete={vi.fn()} />);
    const button = screen.getByRole('button', { name: /continue to setup/i });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button).toBeEnabled();
  });

  it('calls acceptDisclaimer("app_wide", current version) on Continue', async () => {
    const acceptDisclaimer = vi.fn().mockResolvedValue(undefined);
    useHouseholdStore.setState({ acceptDisclaimer } as any);
    render(<Step0Disclaimer onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /continue to setup/i }));
    await waitFor(() => {
      expect(acceptDisclaimer).toHaveBeenCalledWith('app_wide', '1.5');
    });
  });

  it('fires onComplete after acceptDisclaimer resolves', async () => {
    const acceptDisclaimer = vi.fn().mockResolvedValue(undefined);
    useHouseholdStore.setState({ acceptDisclaimer } as any);
    const onComplete = vi.fn();
    render(<Step0Disclaimer onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /continue to setup/i }));
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT fire onComplete if acceptDisclaimer rejects', async () => {
    const acceptDisclaimer = vi.fn().mockRejectedValue(new Error('db down'));
    useHouseholdStore.setState({ acceptDisclaimer } as any);
    const onComplete = vi.fn();
    render(<Step0Disclaimer onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /continue to setup/i }));
    await waitFor(() => {
      expect(acceptDisclaimer).toHaveBeenCalled();
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('W4: the explore action accepts on the REAL db FIRST, then enters explore', async () => {
    const order: string[] = [];
    const acceptDisclaimer = vi.fn().mockImplementation(async () => void order.push('accept'));
    useHouseholdStore.setState({ acceptDisclaimer } as any);
    const enter = vi
      .spyOn(exploreTransitions, 'enterExploreMode')
      .mockImplementation(async () => void order.push('enter'));
    const onComplete = vi.fn();
    render(<Step0Disclaimer onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Explore with sample data first' }));
    await waitFor(() => expect(order).toEqual(['accept', 'enter']));
    expect(acceptDisclaimer).toHaveBeenCalledWith('app_wide', expect.any(String));
    // Entry is a full navigation, not the wizard's own advance.
    expect(onComplete).not.toHaveBeenCalled();
    enter.mockRestore();
  });

  // W4 review (MAJOR 0/3): the spec's entry rule — "Established profiles
  // (persons > 0, or ?section= deep links, or Settings → Revisit setup) never
  // see it" — was documented but never enforced. An established user who runs
  // Settings → Reset disclaimers and then Revisit setup lands on Step 0, and
  // inside explore the Dashboard's tour nudge could write the REAL
  // onboarding.tour.done.v1 key (D-S7's own named key).
  it('W4 entry rule: no explore action once persons exist', () => {
    useHouseholdStore.setState({ acceptDisclaimer: vi.fn() } as any);
    usePersonsStore.setState({
      persons: [{ id: 1, name: 'Alice' } as unknown as Person],
      isLoading: false,
      error: null,
    });
    render(<Step0Disclaimer onComplete={vi.fn()} />);
    expect(
      screen.queryByRole('button', { name: 'Explore with sample data first' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('See a filled-in Cairn before entering your own numbers.'),
    ).not.toBeInTheDocument();
    // The attestation itself is untouched — this is the legal gate.
    expect(screen.getByRole('button', { name: /continue to setup/i })).toBeInTheDocument();
  });

  it('W4 entry rule: no explore action once the wizard has been dismissed once', () => {
    useHouseholdStore.setState({ acceptDisclaimer: vi.fn() } as any);
    // The "DB wiped/replaced under retained WebView storage" state: zero
    // persons, but a retained dismissal marker.
    localStorage.setItem('setupWizard.dismissed.v1', '2026-07-08T12:00:00.000Z');
    render(<Step0Disclaimer onComplete={vi.fn()} />);
    expect(
      screen.queryByRole('button', { name: 'Explore with sample data first' }),
    ).not.toBeInTheDocument();
  });

  it('W4 entry rule: a true first run (no persons, no dismissal) DOES see it', () => {
    useHouseholdStore.setState({ acceptDisclaimer: vi.fn() } as any);
    render(<Step0Disclaimer onComplete={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Explore with sample data first' }),
    ).toBeInTheDocument();
  });

  it('W4: the explore action is gated on the SAME attestation checkbox', () => {
    useHouseholdStore.setState({ acceptDisclaimer: vi.fn() } as any);
    render(<Step0Disclaimer onComplete={vi.fn()} />);
    const explore = screen.getByRole('button', { name: 'Explore with sample data first' });
    expect(explore).toBeDisabled();
    expect(
      screen.getByText('See a filled-in Cairn before entering your own numbers.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(explore).toBeEnabled();
  });

  // W4 (D-S7): the parent must hold Step 0 mounted across the acceptance
  // write, or FlowShell mounts for an instant and writes the REAL
  // setupWizard.progress.v2 key on the way into the sample profile.
  it('W4: signals onExploreEntering(true) BEFORE the acceptance write', async () => {
    const order: string[] = [];
    const acceptDisclaimer = vi.fn().mockImplementation(async () => void order.push('accept'));
    useHouseholdStore.setState({ acceptDisclaimer } as any);
    const enter = vi
      .spyOn(exploreTransitions, 'enterExploreMode')
      .mockImplementation(async () => void order.push('enter'));
    render(
      <Step0Disclaimer
        onComplete={vi.fn()}
        onExploreEntering={(v) => order.push(`entering:${v}`)}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Explore with sample data first' }));
    await waitFor(() => expect(order).toEqual(['entering:true', 'accept', 'enter']));
    enter.mockRestore();
  });

  it('W4: releases the hold when the entry fails, so the wizard is not stuck on Step 0', async () => {
    const calls: boolean[] = [];
    const acceptDisclaimer = vi.fn().mockRejectedValue(new Error('db down'));
    useHouseholdStore.setState({ acceptDisclaimer } as any);
    render(
      <Step0Disclaimer onComplete={vi.fn()} onExploreEntering={(v) => calls.push(v)} />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Explore with sample data first' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await waitFor(() => expect(calls).toEqual([true, false]));
    // W4 review (MINOR 5): the inline slot shows the CONTRACT line (SE-C8),
    // not the raw 'db down' — every rejection shape reads the same.
    expect(
      await screen.findByText('Failed to open sample data. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('db down')).not.toBeInTheDocument();
    warn.mockRestore();
  });
});
