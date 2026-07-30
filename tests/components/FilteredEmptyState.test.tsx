import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { usePersonsStore } from '@/stores/persons-store';
import { FilteredEmptyState } from '@/components/layout/FilteredEmptyState';
import { makePerson } from '../factories';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.search}</div>;
}

beforeEach(() => {
  usePersonsStore.setState({
    persons: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
    isLoading: false, error: null, load: async () => {},
  } as never);
});

const partition = { total: 3, visibleCount: 0, hiddenCount: 3, jointCount: 2, otherCount: 1 };

describe('FilteredEmptyState', () => {
  it('C4/C5: title, capitalized clause, View household action — and NO Add CTA', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/loans?view=p1']}>
        <FilteredEmptyState noun="loans" partition={partition} />
        <LocationProbe />
      </MemoryRouter>,
    );
    expect(screen.getByText("No loans in Alice's name")).toBeInTheDocument();
    expect(screen.getByText('2 joint and 1 owned by Bob not shown.')).toBeInTheDocument();
    expect(screen.queryByText(/add/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View household' }));
    expect(screen.getByTestId('loc')).toHaveTextContent(''); // ?view cleared
  });
  it('joint view derives the joint title', () => {
    render(
      <MemoryRouter initialEntries={['/loans?view=joint']}>
        <FilteredEmptyState noun="loans" partition={{ ...partition, jointCount: 0, otherCount: 3 }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('No joint loans')).toBeInTheDocument();
    expect(screen.getByText('3 individually owned not shown.')).toBeInTheDocument();
  });
  it('title/description overrides win (cannot-be-joint declarations)', () => {
    render(
      <MemoryRouter initialEntries={['/equity-grants?view=joint']}>
        <FilteredEmptyState noun="grants" partition={partition} title="No joint equity grants" description="Equity grants always belong to one person — there are no joint grants." />
      </MemoryRouter>,
    );
    expect(screen.getByText('No joint equity grants')).toBeInTheDocument();
  });
});
