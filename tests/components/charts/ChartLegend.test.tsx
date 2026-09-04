import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChartLegend } from '@/components/charts/ChartLegend';

describe('ChartLegend (Wave 11 T11)', () => {
  it('renders one dot per series with the series color, label text uncolored', () => {
    render(
      <ChartLegend
        payload={[
          { value: 'Mortgage', color: 'rgb(1, 2, 3)' },
          { value: 'Auto', color: 'rgb(4, 5, 6)' },
        ]}
      />,
    );
    const mortgage = screen.getByText('Mortgage');
    const auto = screen.getByText('Auto');
    // Hue lives in the dot, not the label text.
    expect(mortgage.querySelector('span')).toHaveStyle({ background: 'rgb(1, 2, 3)' });
    expect(auto.querySelector('span')).toHaveStyle({ background: 'rgb(4, 5, 6)' });
    // Text is theme-contrast-safe (muted-foreground), never the series color.
    const list = mortgage.closest('ul');
    expect(list).toHaveClass('text-muted-foreground');
  });

  it('renders nothing when payload is empty', () => {
    const { container } = render(<ChartLegend payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  /* W2 review fix (MAJOR 0/1): recharts applies the `type: 'none'` opt-out only
     inside DefaultLegendContent — a custom `content` receives the unfiltered
     payload. Mirroring that skip here is what keeps a `legendType="none"`
     series (the History fan's floor/delta) out of every house legend. */
  it('skips entries opted out with type "none" (recharts DefaultLegendContent parity)', () => {
    render(
      <ChartLegend
        payload={[
          { value: 'Median (p50)', color: 'rgb(1, 2, 3)' },
          { value: 'fan2575', color: 'rgb(4, 5, 6)', type: 'none' },
          { value: 'fanFloor', color: 'transparent', type: 'none' },
        ]}
      />,
    );
    expect(screen.getByText('Median (p50)')).toBeInTheDocument();
    expect(screen.queryByText('fan2575')).toBeNull();
    expect(screen.queryByText('fanFloor')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('renders nothing when every entry is opted out', () => {
    const { container } = render(
      <ChartLegend payload={[{ value: 'fanFloor', type: 'none' }]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
