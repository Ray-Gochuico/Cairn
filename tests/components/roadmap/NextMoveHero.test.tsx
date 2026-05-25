import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NextMoveHero } from '@/components/roadmap/NextMoveHero';
import { NODES } from '@/domain/roadmap/nodes';
import type { NodeId, NodeResult } from '@/types/roadmap';

function renderHero(results: Map<NodeId, NodeResult>) {
  return render(
    <MemoryRouter>
      <NextMoveHero results={results} />
    </MemoryRouter>,
  );
}

describe('NextMoveHero', () => {
  it('renders the "caught up" card when no node is active', () => {
    renderHero(new Map());
    expect(screen.getByText(/caught up/i)).toBeInTheDocument();
  });

  it('picks the lowest-section active node and renders its title, evidence and CTA', () => {
    // s4_contribute_ira is in section 4, s1_emergency_small is in section 1.
    // The hero must pick s1_emergency_small as the earlier one.
    const results = new Map<NodeId, NodeResult>([
      [
        's4_contribute_ira',
        {
          status: 'active',
          evidence: 'pretend IRA evidence',
          cta: { label: 'Open Accounts →', href: '/accounts' },
        },
      ],
      [
        's1_emergency_small',
        {
          status: 'active',
          evidence: '$0 / $5,000 (0%)',
          cta: { label: 'Open Accounts →', href: '/accounts' },
        },
      ],
    ]);
    renderHero(results);

    const target = NODES.find((n) => n.id === 's1_emergency_small')!;
    expect(screen.getByText(target.title)).toBeInTheDocument();
    expect(screen.getByText(/\$0 \/ \$5,000/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /open accounts/i }),
    ).toHaveAttribute('href', '/accounts');
  });

  it('omits the CTA link when the active node has no cta', () => {
    const results = new Map<NodeId, NodeResult>([
      ['s0_create_budget', { status: 'active', evidence: 'no link here' }],
    ]);
    renderHero(results);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('no link here')).toBeInTheDocument();
  });
});
