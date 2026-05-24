import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Step0Disclaimer } from '@/pages/setup/Step0Disclaimer';
import { useHouseholdStore } from '@/stores/household-store';

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
    expect(screen.getByText(/version 1\.0/i)).toBeInTheDocument();
  });

  it('disables Continue until the checkbox is checked', () => {
    render(<Step0Disclaimer onComplete={vi.fn()} />);
    const button = screen.getByRole('button', { name: /continue to setup/i });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button).toBeEnabled();
  });

  it('calls acceptDisclaimer("app_wide", "1.0") on Continue', async () => {
    const acceptDisclaimer = vi.fn().mockResolvedValue(undefined);
    useHouseholdStore.setState({ acceptDisclaimer } as any);
    render(<Step0Disclaimer onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /continue to setup/i }));
    await waitFor(() => {
      expect(acceptDisclaimer).toHaveBeenCalledWith('app_wide', '1.0');
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
});
