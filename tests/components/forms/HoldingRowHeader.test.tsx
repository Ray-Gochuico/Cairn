import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HoldingRowHeader } from '@/components/forms/HoldingForm';

describe('HoldingRowHeader', () => {
  it('renders the four column titles', () => {
    render(<HoldingRowHeader />);
    expect(screen.getByText('Ticker')).toBeInTheDocument();
    expect(screen.getByText('Shares')).toBeInTheDocument();
    expect(screen.getByText('Target %')).toBeInTheDocument();
    expect(screen.getByText('Cost basis')).toBeInTheDocument();
  });

  it('renders the margin hint only when allowMarginHint is set', () => {
    const { unmount } = render(<HoldingRowHeader allowMarginHint />);
    expect(
      screen.getByText(/margin allowed — sum can exceed 100%/i),
    ).toBeInTheDocument();
    unmount();
    render(<HoldingRowHeader />);
    expect(screen.queryByText(/margin allowed/i)).toBeNull();
  });

  it('renders the Actions slot label only when provided (Manage panel passes it)', () => {
    const { unmount } = render(<HoldingRowHeader actionsLabel="Actions" />);
    expect(screen.getByText('Actions')).toBeInTheDocument();
    unmount();
    render(<HoldingRowHeader />);
    expect(screen.queryByText('Actions')).toBeNull();
  });
});
