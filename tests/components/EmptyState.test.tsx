import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Target } from 'lucide-react';
import { EmptyState } from '@/components/layout/EmptyState';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState icon={Target} title="No goals yet" />);
    expect(screen.getByText('No goals yet')).toBeInTheDocument();
  });

  it('renders the optional description', () => {
    render(
      <EmptyState
        icon={Target}
        title="No goals yet"
        description="Add one in Inputs to start tracking."
      />,
    );
    expect(screen.getByText('Add one in Inputs to start tracking.')).toBeInTheDocument();
  });

  it('renders an icon marked aria-hidden (decorative)', () => {
    const { container } = render(<EmptyState icon={Target} title="No goals yet" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a CTA passed via children', () => {
    render(
      <MemoryRouter>
        <EmptyState icon={Target} title="No goals yet">
          <Button asChild>
            <Link to="/inputs/goals">Add your first goal</Link>
          </Button>
        </EmptyState>
      </MemoryRouter>,
    );
    const cta = screen.getByRole('link', { name: /add your first goal/i });
    expect(cta).toHaveAttribute('href', '/inputs/goals');
  });

  it('does not render a description block when none is supplied', () => {
    render(<EmptyState icon={Target} title="Bare" />);
    // Title present, but no stray paragraph text.
    expect(screen.getByText('Bare')).toBeInTheDocument();
  });
});
