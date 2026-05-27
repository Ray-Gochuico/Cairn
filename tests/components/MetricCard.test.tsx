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

  it('renders label with line-clamp-2 so long labels wrap to 2 lines without mid-word ellipsis', () => {
    // The prior contract used `truncate` (overflow-hidden + ellipsis + nowrap),
    // which at <1280px ellipsed Liquid Investments / Awaiting Reimbursement /
    // Spending vs Budget mid-word in the Dashboard pill grid. We now allow the
    // label to wrap onto 2 lines on whitespace before falling back to an
    // ellipsis — that resolves the readability regression at 1024px.
    render(
      <MemoryRouter>
        <MetricCard label="Awaiting Reimbursement" value="$1" />
      </MemoryRouter>,
    );
    const label = screen.getByTestId('metric-card-label');
    expect(label).toHaveClass('line-clamp-2');
    expect(label).not.toHaveClass('truncate'); // explicit anti-regression
    expect(label).toHaveClass('break-words');
    // Full text remains available via title for mouse-hover discovery.
    expect(label).toHaveAttribute('title', 'Awaiting Reimbursement');
  });

  it('exposes the full label and value via aria-label on the wrapping link for keyboard/screen-reader users', () => {
    // line-clamp-2 still produces a trailing ellipsis if a label is so long
    // that two lines aren't enough. The wrapping <Link>'s aria-label is the
    // accessibility-safety-net: screen readers and keyboard-focus users
    // always hear the full label and value regardless of what's visible.
    render(
      <MemoryRouter>
        <MetricCard label="Awaiting Reimbursement" value="$12,345" href="/spending" />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('aria-label', 'Awaiting Reimbursement: $12,345');
  });

  it('does not set aria-label when no href is provided (no link to label)', () => {
    render(
      <MemoryRouter>
        <MetricCard label="Net Worth" value="$1" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
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
