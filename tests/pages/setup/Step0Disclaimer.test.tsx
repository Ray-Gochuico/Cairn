import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Step0Disclaimer from '@/pages/setup/Step0Disclaimer';
import { useHouseholdStore } from '@/stores/household-store';
import * as exploreTransitions from '@/lib/explore-transitions';

describe('Step0Disclaimer', () => {
  beforeEach(() => {
    // Stub acceptDisclaimer so the test doesn't touch the DB layer.
    useHouseholdStore.setState({
      household: null,
      isLoading: false,
      error: null,
    });
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
});
