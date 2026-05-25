import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ChartToolbar from '@/components/whatif/ChartToolbar';
import { useScenariosStore } from '@/stores/scenarios-store';

function resetStore() {
  useScenariosStore.setState({
    scenarios: [],
    isLoading: false,
    error: null,
    horizonMonths: 360,
    dollarMode: 'nominal',
    inflation: 0.025,
    defaultReturnRate: 0.07,
  });
}

describe('ChartToolbar', () => {
  beforeEach(() => { resetStore(); });

  it('renders the horizon slider showing the current value in years', () => {
    render(<MemoryRouter><ChartToolbar /></MemoryRouter>);
    expect(screen.getByText(/30 years/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/horizon/i)).toHaveValue('360');
  });

  it('moving the horizon slider updates the store (clamped to [60, 480])', () => {
    render(<MemoryRouter><ChartToolbar /></MemoryRouter>);
    const slider = screen.getByLabelText(/horizon/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '240' } });
    expect(useScenariosStore.getState().horizonMonths).toBe(240);
  });

  it('renders nominal/real toggle with nominal pressed by default', () => {
    render(<MemoryRouter><ChartToolbar /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /nominal/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^real/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking Real flips dollarMode and aria-pressed state', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ChartToolbar /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /^real/i }));
    expect(useScenariosStore.getState().dollarMode).toBe('real');
    expect(screen.getByRole('button', { name: /^real/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /nominal/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects the store state when horizonMonths changes externally', () => {
    useScenariosStore.setState({ horizonMonths: 120 });
    render(<MemoryRouter><ChartToolbar /></MemoryRouter>);
    expect(screen.getByText(/10 years/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/horizon/i)).toHaveValue('120');
  });
});
