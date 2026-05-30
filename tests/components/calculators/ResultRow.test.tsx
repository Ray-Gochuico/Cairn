import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultRow } from '@/components/calculators/ResultRow';

describe('ResultRow', () => {
  it('renders label + value, value carries the testId', () => {
    render(<ResultRow label="Estimated federal" value="$1,234" testId="fed" />);
    expect(screen.getByText('Estimated federal')).toBeInTheDocument();
    const v = screen.getByTestId('fed');
    expect(v.textContent).toBe('$1,234');
    expect(v.className).toContain('tabular-nums');
  });

  it('emphasis bumps the value weight', () => {
    render(<ResultRow label="Net" value="$9" emphasis testId="net" />);
    expect(screen.getByTestId('net').className).toContain('font-semibold');
  });

  it('orientation="inline" renders label-left / value-right (Paycheck contract)', () => {
    // PaycheckBreakdownRow composes ResultRow with orientation="inline" inside a
    // label-left / amount-right grid; the inline variant must lay the row out
    // horizontally (NOT stack the value under the label) while keeping the
    // tabular-nums + emphasis weight + the testId on the value.
    const { container } = render(
      <ResultRow label="Federal" value="$1,234" orientation="inline" emphasis testId="fed-inline" />,
    );
    // Row container is a horizontal flex with the label/value pushed apart.
    const row = container.firstChild as HTMLElement;
    expect(row.className).toContain('flex');
    expect(row.className).toContain('items-center');
    expect(row.className).toContain('justify-between');
    // Value still carries tabular-nums + emphasis weight + testId.
    const v = screen.getByTestId('fed-inline');
    expect(v.textContent).toBe('$1,234');
    expect(v.className).toContain('tabular-nums');
    expect(v.className).toContain('font-semibold');
    // Label renders before the value in document order (label-left).
    const label = screen.getByText('Federal');
    expect(label.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('orientation defaults to "stack" (label over value — keeps the 3 cards byte-identical)', () => {
    const { container } = render(<ResultRow label="State" value="$5" testId="state-default" />);
    // Default stack variant is NOT a horizontal flex row.
    expect((container.firstChild as HTMLElement).className).not.toContain('justify-between');
  });
});
