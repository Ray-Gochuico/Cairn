import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InlineLink } from '@/components/calculators/InlineLink';

describe('InlineLink', () => {
  it('renders an anchor with the persistent-underline recipe', () => {
    render(
      <MemoryRouter>
        <InlineLink to="/investments">Adjust targets</InlineLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Adjust targets' });
    expect(link).toHaveAttribute('href', '/investments');
    expect(link).toHaveClass('text-primary');
    expect(link).toHaveClass('underline');
    expect(link).toHaveClass('underline-offset-4');
  });

  it('merges a caller className', () => {
    render(
      <MemoryRouter>
        <InlineLink to="/loans" className="text-sm">
          Add loans
        </InlineLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Add loans' });
    expect(link).toHaveClass('text-sm');
    expect(link).toHaveClass('underline');
  });
});
