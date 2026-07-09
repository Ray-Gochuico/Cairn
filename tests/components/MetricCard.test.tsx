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
  it('the value never carries truncation classes (W10 design: magnitude is the point)', () => {
    render(
      <MemoryRouter>
        <MetricCard label="Net worth" value="$12,345,678" />
      </MemoryRouter>,
    );
    const v = screen.getByTestId('metric-card-value');
    expect(v.className).not.toMatch(/text-ellipsis|overflow-hidden/);
    expect(v.className).toMatch(/whitespace-nowrap/);
    // break-words is the bug — it allowed "$569,94 6" splits. Must be gone.
    expect(v).not.toHaveClass('break-words');
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

  it('link name includes value, delta and subtitle', () => {
    // Wave-4 a11y: delta and subtitle are visible to sighted users, so the
    // link's accessible name carries them too (em-dash separators read as
    // natural pauses).
    render(
      <MemoryRouter>
        <MetricCard
          label="Net worth"
          value="$1,234"
          delta="+$100 MoM"
          subtitle="as of Jul 2"
          href="/net-worth"
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('link', { name: 'Net worth: $1,234 — +$100 MoM — as of Jul 2' }),
    ).toBeInTheDocument();
  });

  it('does not set aria-label when no href is provided (no link to label)', () => {
    render(
      <MemoryRouter>
        <MetricCard label="Net Worth" value="$1" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders the full value text and drops the now-pointless title mirror (W10 design)', () => {
    render(
      <MemoryRouter>
        <MetricCard label="X" value="$12,345,678" />
      </MemoryRouter>,
    );
    const value = screen.getByTestId('metric-card-value');
    // The value no longer ellipsizes, so it shows in full and needs no title.
    expect(value).toHaveTextContent('$12,345,678');
    expect(value).not.toHaveAttribute('title');
  });

  it('uses a smaller base font that scales up on larger screens', () => {
    render(
      <MemoryRouter>
        <MetricCard label="X" value="$1" />
      </MemoryRouter>,
    );
    const value = screen.getByTestId('metric-card-value');
    // W10: stepped down one notch (text-lg base) so long values fit at 1280px
    // without ellipsizing; scales up on larger screens.
    expect(value).toHaveClass('text-lg');
    expect(value.className).toMatch(/(sm|md|lg):text-/);
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

  describe('valueTone (wave-7 W5)', () => {
    it('positive/negative tone the VALUE with the status tokens', () => {
      render(
        <MemoryRouter>
          <MetricCard label="Net" value="+$120.00" valueTone="positive" />
        </MemoryRouter>,
      );
      expect(screen.getByTestId('metric-card-value').className).toContain('text-success-foreground');
    });

    it('omitted valueTone leaves the value untinted (existing renders byte-identical)', () => {
      render(
        <MemoryRouter>
          <MetricCard label="Money out" value="$50.00" />
        </MemoryRouter>,
      );
      const cls = screen.getByTestId('metric-card-value').className;
      expect(cls).not.toContain('text-success-foreground');
      expect(cls).not.toContain('text-destructive-soft-foreground');
      expect(cls).not.toContain('text-muted-foreground'); // value ≠ delta default
    });
  });
});
