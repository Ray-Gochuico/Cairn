import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MetricCard from '@/components/cards/MetricCard';

/**
 * Pill text overflow: the dashboard metric pills used to break mid-character
 * ("$569,94 6", "NET WOR..."). These tests pin the CSS contract that prevents
 * that: the value renders on a single non-wrapping line with ellipsis on
 * overflow, never split inside a word or numeric.
 */
describe('MetricCard text overflow', () => {
  it('renders value with whitespace-nowrap and overflow-ellipsis (no mid-word breaks)', () => {
    render(
      <MemoryRouter>
        <MetricCard label="Net Worth" value="$569,946" />
      </MemoryRouter>,
    );
    const value = screen.getByTestId('metric-card-value');
    expect(value).toHaveClass('whitespace-nowrap');
    expect(value).toHaveClass('overflow-hidden');
    expect(value).toHaveClass('text-ellipsis');
    // break-words is the bug — it allowed "$569,94 6" splits. Must be gone.
    expect(value).not.toHaveClass('break-words');
  });

  it('renders label with truncate so long labels show "Net Wor..." not "NET WOR"', () => {
    render(
      <MemoryRouter>
        <MetricCard label="Net Worth" value="$1" />
      </MemoryRouter>,
    );
    const label = screen.getByTestId('metric-card-label');
    expect(label).toHaveClass('truncate');
    // Full text available via title for hover.
    expect(label).toHaveAttribute('title', 'Net Worth');
  });

  it('exposes the full value as a title attribute for hover discovery', () => {
    render(
      <MemoryRouter>
        <MetricCard label="X" value="$12,345,678" />
      </MemoryRouter>,
    );
    const value = screen.getByTestId('metric-card-value');
    expect(value).toHaveAttribute('title', '$12,345,678');
  });

  it('uses a smaller base font that scales up on larger screens', () => {
    render(
      <MemoryRouter>
        <MetricCard label="X" value="$1" />
      </MemoryRouter>,
    );
    const value = screen.getByTestId('metric-card-value');
    // text-xl on mobile (where pills are narrowest), text-3xl on md+
    expect(value).toHaveClass('text-xl');
    expect(value.className).toMatch(/(sm|md):text-/);
  });

  it('wraps in a link when href provided and stays a plain card otherwise', () => {
    const { rerender } = render(
      <MemoryRouter>
        <MetricCard label="X" value="$1" href="/net-worth" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', '/net-worth');

    rerender(
      <MemoryRouter>
        <MetricCard label="X" value="$1" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
