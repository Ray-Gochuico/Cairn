import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SectionCard } from '@/components/roadmap/SectionCard';
import type {
  NodeId,
  NodeResult,
  RoadmapContext,
  RoadmapNode,
} from '@/types/roadmap';
import type { Household } from '@/types/schema';
import { FilingStatus } from '@/types/enums';

function makeNode(id: NodeId, title = id): RoadmapNode {
  return {
    id,
    section: 1,
    kind: 'action',
    title,
    body: `Body for ${id}`,
    prerequisites: [],
    evaluate: () => ({ status: 'not-started' }),
  };
}

function makeHousehold(): Household {
  return {
    id: 1,
    name: null,
    filingStatus: FilingStatus.SINGLE,
    state: 'CA',
    city: null,
    monthlyExpenseBaseline: 5000,
    withdrawalRate: 0.04,
    inflationAssumption: 0.03,
    growthScenarios: [],
    disclaimerAcceptedAt: null,
    disclaimerVersionAccepted: null,
    roadmapDisclaimerAcceptedAt: null,
    roadmapDisclaimerVersionAccepted: null,
    interestThresholdLowPct: null,
    interestThresholdHighPct: null,
    hasWrittenIps: null,
    hasHsaQualifiedHdhp: null,
    makesCharitableGifts: null,
    upcomingLargePurchase: null,
    upcomingPurchaseAmount: null,
    upcomingPurchaseMonths: null,
  };
}

function makeCtx(): RoadmapContext {
  return {
    household: makeHousehold(),
    persons: [],
    accounts: [],
    loans: [],
    contributions: [],
    snapshots: [],
    transactions: [],
    overrides: new Map(),
    thresholds: { low: 5, high: 8 },
    taxYear: 2026,
    today: new Date('2026-05-23T00:00:00Z'),
  };
}

function renderSection(opts: {
  nodes: RoadmapNode[];
  results: Map<NodeId, NodeResult>;
}) {
  return render(
    <MemoryRouter>
      <SectionCard
        section={1}
        title="Test Section"
        nodes={opts.nodes}
        results={opts.results}
        ctx={makeCtx()}
      />
    </MemoryRouter>,
  );
}

describe('SectionCard', () => {
  beforeEach(() => {});

  it('renders the section number and title in the header', () => {
    renderSection({ nodes: [makeNode('n1')], results: new Map() });
    expect(screen.getByText('Section 1')).toBeInTheDocument();
    expect(screen.getByText('Test Section')).toBeInTheDocument();
  });

  it('shows X/Y done progress, excluding info-status nodes from the denominator', () => {
    const results = new Map<NodeId, NodeResult>([
      ['a', { status: 'done' }],
      ['b', { status: 'done' }],
      ['c', { status: 'not-started' }],
      ['d', { status: 'info' }],
    ]);
    renderSection({
      nodes: ['a', 'b', 'c', 'd'].map((id) => makeNode(id)),
      results,
    });
    // 2 done out of 3 non-info
    expect(screen.getByLabelText('progress').textContent).toMatch(/2\/3/);
  });

  it('shows an arrow indicator when at least one node is active', () => {
    const results = new Map<NodeId, NodeResult>([
      ['a', { status: 'done' }],
      ['b', { status: 'active' }],
    ]);
    renderSection({
      nodes: ['a', 'b'].map((id) => makeNode(id)),
      results,
    });
    expect(screen.getByLabelText('progress').textContent).toContain('→');
  });

  it('shows a checkmark indicator when every counted node is done', () => {
    const results = new Map<NodeId, NodeResult>([
      ['a', { status: 'done' }],
      ['b', { status: 'done' }],
    ]);
    renderSection({
      nodes: ['a', 'b'].map((id) => makeNode(id)),
      results,
    });
    expect(screen.getByLabelText('progress').textContent).toContain('✓');
  });

  it('auto-expands when a node is active and renders its title', () => {
    const results = new Map<NodeId, NodeResult>([
      ['a', { status: 'active', evidence: 'do this now' }],
    ]);
    renderSection({
      nodes: [makeNode('a', 'Live Node')],
      results,
    });
    // Body is open by default because of active state.
    expect(screen.getByText('Live Node')).toBeInTheDocument();
    expect(screen.getByText('do this now')).toBeInTheDocument();
  });

  it('starts collapsed when no node is active and toggles open on click', () => {
    const results = new Map<NodeId, NodeResult>([
      ['a', { status: 'not-started' }],
    ]);
    renderSection({
      nodes: [makeNode('a', 'Inert Node')],
      results,
    });
    // Initially collapsed → row not in document.
    expect(screen.queryByText('Inert Node')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /test section/i }));
    expect(screen.getByText('Inert Node')).toBeInTheDocument();
    // Click again → collapses.
    fireEvent.click(screen.getByRole('button', { name: /test section/i }));
    expect(screen.queryByText('Inert Node')).toBeNull();
  });
});
