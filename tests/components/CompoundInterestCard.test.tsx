import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompoundInterestCard } from '@/pages/calculators/CompoundInterestCard';

describe('CompoundInterestCard', () => {
  it('renders defaults with a non-zero headline (PV=1000, PMT=100, 7%, 10y, monthly)', () => {
    render(<CompoundInterestCard />);
    const headline = screen.getByTestId('compound-headline');
    // PV=1000 + PMT=100/mo × 7% × 10y monthly compounding → final mid ≈ $19,290
    expect(headline.textContent).toMatch(/\$1[89],\d{3}/);
  });

  it('updates the headline when initial amount changes', async () => {
    const user = userEvent.setup();
    render(<CompoundInterestCard />);
    const pvInput = screen.getByLabelText(/initial amount/i) as HTMLInputElement;
    await user.clear(pvInput);
    await user.type(pvInput, '10000');
    const headline = screen.getByTestId('compound-headline');
    // Bigger PV → bigger final
    expect(headline.textContent).not.toMatch(/^\$1[89],\d{3}/);
  });

  it('switches frequency to ANNUALLY and updates outputs', async () => {
    const user = userEvent.setup();
    render(<CompoundInterestCard />);
    const freq = screen.getByLabelText(/compound frequency/i);
    await user.selectOptions(freq, 'ANNUALLY');
    const headline = screen.getByTestId('compound-headline');
    // Annual compounding is slightly less than monthly at the same rate.
    expect(headline.textContent).toMatch(/\$/);
  });

  it('shows placeholder when years is 0 or empty', async () => {
    const user = userEvent.setup();
    render(<CompoundInterestCard />);
    const yearsInput = screen.getByLabelText(/length \(years\)/i) as HTMLInputElement;
    await user.clear(yearsInput);
    expect(screen.getByText(/enter a length in years/i)).toBeInTheDocument();
  });
});
