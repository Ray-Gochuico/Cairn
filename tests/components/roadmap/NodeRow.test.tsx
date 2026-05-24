import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NodeRow } from '@/components/roadmap/NodeRow';
import type { NodeId, NodeResult, RoadmapContext, RoadmapNode } from '@/types/roadmap';
import type { Household } from '@/types/schema';
import { FilingStatus } from '@/types/enums';

function makeNode(id: NodeId, patch: Partial<RoadmapNode> = {}): RoadmapNode {
  return {
    id,
    section: 1,
    kind: 'action',
    title: 'Pay off high-interest debt',
    body: 'Chart text for this node',
    prerequisites: [],
    evaluate: () => ({ status: 'not-started' }),
    ...patch,
  };
}

function makeCtx(): RoadmapContext {
  const household: Household = {
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
  return {
    household,
    persons: [],
    accounts: [],
    loans: [],
    contributions: [],
    snapshots: [],
    overrides: new Map(),
    thresholds: { low: 5, high: 8 },
    taxYear: 2026,
    today: new Date('2026-05-23T00:00:00Z'),
  };
}

function renderRow(opts: { node?: RoadmapNode; result: NodeResult }) {
  return render(
    <MemoryRouter>
      <NodeRow
        node={opts.node ?? makeNode('n1')}
        result={opts.result}
        ctx={makeCtx()}
      />
    </MemoryRouter>,
  );
}

describe('NodeRow', () => {
  it('renders title and evidence', () => {
    renderRow({
      result: { status: 'active', evidence: '2 loans ≥ 8%' },
    });
    expect(screen.getByText('Pay off high-interest debt')).toBeInTheDocument();
    expect(screen.getByText('2 loans ≥ 8%')).toBeInTheDocument();
  });

  it('renders a CTA link when provided', () => {
    renderRow({
      result: {
        status: 'active',
        cta: { label: 'Open Loans →', href: '/loans' },
      },
    });
    const link = screen.getByRole('link', { name: /open loans/i });
    expect(link).toHaveAttribute('href', '/loans');
  });

  it('shows (overridden) label when result has an autoResult side channel', () => {
    renderRow({
      result: {
        status: 'done',
        autoResult: { status: 'active', evidence: 'computed' },
      },
    });
    expect(screen.getByText(/overridden/i)).toBeInTheDocument();
  });

  it('renders DecisionPrompt when the result has a question', async () => {
    let answeredWith: string | null = null;
    renderRow({
      result: {
        status: 'unanswered',
        question: {
          prompt: 'Have you written an IPS?',
          answerType: 'yes-no',
          onAnswer: async (v) => {
            answeredWith = v;
          },
        },
      },
    });
    expect(screen.getByText('Have you written an IPS?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    // The handler is async; flush microtasks via the test runner's awaitable.
    await Promise.resolve();
    expect(answeredWith).toBe('yes');
  });

  it('opens the detail drawer when the (i) button is clicked', () => {
    renderRow({ result: { status: 'active', evidence: 'because reasons' } });
    // Drawer is initially closed → chart-text body not present.
    expect(screen.queryByText('Chart text for this node')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: /details for pay off high-interest debt/i }),
    );
    expect(screen.getByText('Chart text for this node')).toBeInTheDocument();
  });

  it('applies line-through styling on skipped nodes', () => {
    renderRow({ result: { status: 'skipped' } });
    const title = screen.getByText('Pay off high-interest debt');
    expect(title.className).toContain('line-through');
  });
});
