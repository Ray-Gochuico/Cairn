import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ConcentrationHealthCard from '@/components/investments/ConcentrationHealthCard';
import type { ConcentrationReport, ConcentrationWarning } from '@/lib/concentration';

/**
 * ConcentrationHealthCard renders straight off an injected report prop —
 * no stores or DB. We construct a report with one warning per severity and
 * assert the visible severity chips + the aria-hidden icon (the chip, not
 * the tint, is now the accessible severity signal).
 */
function makeReport(warnings: ConcentrationWarning[]): ConcentrationReport {
  return {
    perTicker: [{ ticker: 'AAPL', effectiveExposure: 100, pctOfPortfolio: 1 }],
    tickerExposures: [{ ticker: 'AAPL', effectiveExposure: 100 }],
    perAssetClass: [],
    totalLeverage: 1,
    warnings,
  };
}

const HIGH: ConcentrationWarning = {
  type: 'PER_TICKER_HIGH',
  severity: 'HIGH',
  message: 'AAPL is 100.0% of effective exposure',
  ticker: 'AAPL',
  exposurePct: 1,
};
const MEDIUM: ConcentrationWarning = {
  type: 'LEVERAGE_HIGH',
  severity: 'MEDIUM',
  message: 'Total leverage is 1.8x',
  exposurePct: 1.8,
};
const LOW: ConcentrationWarning = {
  type: 'PER_TICKER_SOFT',
  severity: 'LOW',
  message: 'MSFT is getting concentrated',
  ticker: 'MSFT',
  exposurePct: 0.2,
};

describe('ConcentrationHealthCard severity chips', () => {
  it('renders a "High" chip with the destructive token on a HIGH warning', () => {
    render(<ConcentrationHealthCard report={makeReport([HIGH])} />);
    const chip = screen.getByText('High');
    expect(chip).toHaveClass('bg-destructive-soft', 'text-destructive-soft-foreground');
  });

  it('renders a "Watch" chip with the warning token on a MEDIUM warning', () => {
    render(<ConcentrationHealthCard report={makeReport([MEDIUM])} />);
    const chip = screen.getByText('Watch');
    expect(chip).toHaveClass('bg-warning-soft', 'text-warning-foreground');
  });

  it('renders a "Note" chip with the info token on a LOW warning', () => {
    render(<ConcentrationHealthCard report={makeReport([LOW])} />);
    const chip = screen.getByText('Note');
    expect(chip).toHaveClass('bg-info-soft', 'text-info-foreground');
  });

  it('marks the severity icon aria-hidden so the chip is the accessible signal', () => {
    const { container } = render(<ConcentrationHealthCard report={makeReport([HIGH])} />);
    expect(screen.queryByLabelText(/severity/i)).toBeNull();
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});
