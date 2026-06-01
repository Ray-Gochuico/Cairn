import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BacktestDisclosureCallout } from '@/components/backtest/BacktestDisclosureCallout';
import { DISCLOSURES } from '@/legal/disclosures';

describe('BacktestDisclosureCallout', () => {
  it('renders with data-testid="backtest-disclosure-callout"', () => {
    render(<BacktestDisclosureCallout />);
    expect(screen.getByTestId('backtest-disclosure-callout')).toBeInTheDocument();
  });

  it('references the backtest disclosure (not-a-prediction heading)', () => {
    render(<BacktestDisclosureCallout />);
    expect(screen.getByText(/not a prediction/i)).toBeInTheDocument();
  });

  it('states that past results do not predict future returns', () => {
    render(<BacktestDisclosureCallout />);
    expect(screen.getByText(/past results do not predict future returns/i)).toBeInTheDocument();
  });

  it('clarifies success rate is a count not a probability', () => {
    render(<BacktestDisclosureCallout />);
    // The callout should communicate count-not-probability
    expect(screen.getByText(/not a probability/i)).toBeInTheDocument();
  });

  it('mentions tax brackets are held at 2026 levels', () => {
    render(<BacktestDisclosureCallout />);
    expect(screen.getByText(/tax brackets are held at 2026 levels/i)).toBeInTheDocument();
  });

  it('has the expected DISCLOSURES.backtest title in the disclosure registry', () => {
    // Verify the disclosure registry has the backtest entry this callout is
    // based on — so if disclosures.ts changes, this test flags the drift.
    expect(DISCLOSURES.backtest.title).toBe('About the Historical Backtest');
    expect(DISCLOSURES.backtest.version).toBe('1.0');
  });
});
