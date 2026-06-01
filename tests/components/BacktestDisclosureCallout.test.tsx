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

  it('states returns are real (CPI-adjusted) and gross of fees (B1/M6: consistent with registry)', () => {
    render(<BacktestDisclosureCallout />);
    // The registry body was corrected from "nominal index returns" to real
    // stock/bond returns; the always-visible callout must say the same thing.
    expect(screen.getByText(/real \(inflation-adjusted\)/i)).toBeInTheDocument();
    expect(screen.getByText(/before(?:.|\n)*fees/i)).toBeInTheDocument();
  });

  it('drift-guard: callout stays consistent with the DISCLOSURES.backtest registry entry', () => {
    // The callout is a hand-written paraphrase of DISCLOSURES.backtest. This
    // guard pins it to the registry: a future body edit bumps the registry
    // version, which trips this assertion and forces a conscious callout review.
    expect(DISCLOSURES.backtest.title).toBe('About the Historical Backtest');
    expect(DISCLOSURES.backtest.version).toBe('1.1');

    render(<BacktestDisclosureCallout />);
    // The callout must carry the registry's load-bearing claims.
    expect(screen.getByText(/not a prediction/i)).toBeInTheDocument();
    expect(screen.getByText(/not a probability/i)).toBeInTheDocument();
    expect(screen.getByText(/2026 levels/i)).toBeInTheDocument();
    expect(screen.getByText(/real \(inflation-adjusted\)/i)).toBeInTheDocument();
  });
});
