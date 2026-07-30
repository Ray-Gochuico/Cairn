import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { usePersonsStore } from '@/stores/persons-store';
import { ScopeCaption } from '@/components/layout/ScopeCaption';
import { partitionHidden } from '@/lib/view-scope';
import { makePerson } from '../factories';

const rows = [
  { ownerPersonId: 1 }, { ownerPersonId: 1 }, { ownerPersonId: 2 },
  { ownerPersonId: null }, { ownerPersonId: null },
];
const p1Visible = rows.filter((r) => r.ownerPersonId === 1);

function renderAt(entry: string, partition = partitionHidden(rows, p1Visible, (r) => r.ownerPersonId)) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ScopeCaption noun="loans" partition={partition} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  usePersonsStore.setState({
    persons: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
    isLoading: false, error: null, load: async () => {},
  } as never);
});

describe('ScopeCaption', () => {
  it('C2: person view with joint + other hidden', () => {
    renderAt('/loans?view=p1');
    expect(screen.getByTestId('scope-caption')).toHaveTextContent(
      "Showing Alice's loans: 2 of 5 — 2 joint and 1 owned by Bob not shown.",
    );
  });
  it('C3: joint view grammar', () => {
    const jointVisible = rows.filter((r) => r.ownerPersonId === null);
    render(
      <MemoryRouter initialEntries={['/loans?view=joint']}>
        <ScopeCaption noun="loans" partition={partitionHidden(rows, jointVisible, (r) => r.ownerPersonId)} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('scope-caption')).toHaveTextContent(
      'Showing joint loans: 2 of 5 — 3 individually owned not shown.',
    );
  });
  it('renders nothing in household view, when nothing is hidden, or when the view is empty', () => {
    renderAt('/loans');
    expect(screen.queryByTestId('scope-caption')).not.toBeInTheDocument();
  });
  it('renders nothing when nothing is hidden', () => {
    renderAt('/loans?view=p1', partitionHidden(rows, rows, (r) => r.ownerPersonId));
    expect(screen.queryByTestId('scope-caption')).not.toBeInTheDocument();
  });
  it('renders nothing when the view is empty (FilteredEmptyState territory)', () => {
    renderAt('/loans?view=p1', partitionHidden(rows, [], (r) => r.ownerPersonId));
    expect(screen.queryByTestId('scope-caption')).not.toBeInTheDocument();
  });
});
