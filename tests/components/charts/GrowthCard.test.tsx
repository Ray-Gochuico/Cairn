import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GrowthCard from '@/components/charts/GrowthCard';
import type { HorizonGrowth } from '@/lib/growth-horizons';

function horizon(key: string, label: string, over: Partial<HorizonGrowth> = {}): HorizonGrowth {
  return {
    key, label, baselineDate: '2026-06-01',
    current: 110_000, baseline: 100_000, deltaAbs: 10_000, deltaPct: 0.1,
    available: true, ...over,
  };
}
const HORIZONS: HorizonGrowth[] = [
  horizon('1d', 'Since yesterday'),
  horizon('1w', 'Past week'),
  horizon('1m', 'Past month'),
  horizon('1q', 'Past quarter', { deltaAbs: -5_000, deltaPct: -0.05, current: 95_000 }),
  horizon('1y', 'Past year', { available: false, current: null, baseline: null, deltaAbs: null, deltaPct: null }),
];

describe('GrowthCard — horizon chips', () => {
  it('renders all five horizons as tabs with short labels + full aria labels', () => {
    render(<GrowthCard title="Investments growth" horizons={HORIZONS} />);
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['1D', '1W', '1M', '1Q', '1Y']);
    expect(screen.getByRole('tab', { name: 'Since yesterday' })).toHaveAttribute('aria-selected', 'true');
  });

  it('clicking a chip drives the big number + delta', async () => {
    render(<GrowthCard title="Investments growth" horizons={HORIZONS} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Past quarter' }));
    expect(screen.getByText('$95,000')).toBeInTheDocument();
    expect(screen.getByText(/-\$5,000|−\$5,000/)).toBeInTheDocument();
    expect(screen.getByText('Past quarter')).toBeInTheDocument();
  });

  it('unavailable horizon shows "Not enough history yet"', async () => {
    render(<GrowthCard title="Investments growth" horizons={HORIZONS} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Past year' }));
    expect(screen.getByText(/not enough history yet/i)).toBeInTheDocument();
  });

  it('the card is no longer a giant button (no role=button wrapper, no chevrons)', () => {
    render(<GrowthCard title="Investments growth" horizons={HORIZONS} />);
    expect(screen.queryByRole('button', { name: /next time horizon/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /previous time horizon/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /investments growth/i })).not.toBeInTheDocument();
  });

  it('empty horizons still renders a minimal card', () => {
    render(<GrowthCard title="T" horizons={[]} />);
    expect(screen.getByText('No data.')).toBeInTheDocument();
  });
});
