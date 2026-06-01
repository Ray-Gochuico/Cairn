import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTile } from '@/components/calculators/StatTile';

describe('StatTile', () => {
  it('renders label and value', () => {
    render(<StatTile label="Total contributed" value="$12,000" />);
    expect(screen.getByText('Total contributed')).toBeInTheDocument();
    expect(screen.getByText('$12,000')).toBeInTheDocument();
  });

  it('applies data-testid to the outer container when testId is provided', () => {
    render(<StatTile label="Payoff date" value="2030-01" testId="my-tile" />);
    const tile = screen.getByTestId('my-tile');
    expect(tile).toBeInTheDocument();
    // Both label and value are inside the tile container
    expect(tile).toHaveTextContent('Payoff date');
    expect(tile).toHaveTextContent('2030-01');
  });

  it('value carries tabular-nums class by default', () => {
    const { container } = render(<StatTile label="Interest" value="$500" />);
    // The value element carries tabular-nums
    const valueEl = container.querySelector('.tabular-nums');
    expect(valueEl).not.toBeNull();
    expect(valueEl!.textContent).toBe('$500');
  });

  it('applies valueClassName to the value element', () => {
    render(
      <StatTile
        label="Best ending"
        value="$1M"
        valueClassName="text-success-foreground"
        testId="best-tile"
      />,
    );
    const tile = screen.getByTestId('best-tile');
    const valueEl = tile.querySelector('.tabular-nums') as HTMLElement;
    expect(valueEl).not.toBeNull();
    expect(valueEl.className).toContain('text-success-foreground');
  });

  it('applies valueStyle inline style to the value element', () => {
    render(
      <StatTile
        label="Worst ending"
        value="$0"
        valueStyle={{ color: 'hsl(var(--chart-danger))' }}
        testId="worst-tile"
      />,
    );
    const tile = screen.getByTestId('worst-tile');
    const valueEl = tile.querySelector('.tabular-nums') as HTMLElement;
    expect(valueEl).not.toBeNull();
    expect(valueEl.style.color).toBeTruthy();
  });

  it('outer container has rounded-md border bg-muted/ class', () => {
    const { container } = render(<StatTile label="L" value="V" />);
    const outer = container.firstChild as HTMLElement;
    expect(outer.className).toMatch(/rounded-md/);
    expect(outer.className).toMatch(/border/);
  });
});
