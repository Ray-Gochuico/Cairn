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
});
