import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeDetailDrawer } from '@/components/roadmap/NodeDetailDrawer';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import type { NodeResult, RoadmapContext, RoadmapNode } from '@/types/roadmap';
import type { Household } from '@/types/schema';
import { FilingStatus } from '@/types/enums';

function makeNode(): RoadmapNode {
  return {
    id: 's1_employer_match',
    section: 1,
    kind: 'action',
    title: 'Capture the full employer match',
    body: 'Match details from the chart.',
    prerequisites: [],
    evaluate: () => ({ status: 'active' }),
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

function renderDrawer(opts: {
  result: NodeResult;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  return render(
    <NodeDetailDrawer
      node={makeNode()}
      result={opts.result}
      ctx={makeCtx()}
      open={opts.open ?? true}
      onOpenChange={opts.onOpenChange ?? (() => {})}
    />,
  );
}

describe('NodeDetailDrawer', () => {
  beforeEach(() => {
    useRoadmapOverridesStore.setState({
      overridesByNodeId: new Map(),
      isLoading: false,
      error: null,
      load: async () => {},
      setOverride: vi.fn().mockResolvedValue(undefined),
      clearOverride: vi.fn().mockResolvedValue(undefined),
    } as any);
  });

  it('renders nothing when open=false', () => {
    const { container } = renderDrawer({
      result: { status: 'active' },
      open: false,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the three sections: chart text, calculation, actions', () => {
    renderDrawer({ result: { status: 'active', evidence: '2 loans ≥ 8%' } });
    // Section headings render as uppercase short labels.
    expect(
      screen.getByRole('heading', { name: /^from the chart$/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Match details from the chart.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /how this was calculated/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('2 loans ≥ 8%')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /override status/i }),
    ).toBeInTheDocument();
  });

  it('shows the auto-vs-override line when an override is active', () => {
    renderDrawer({
      result: {
        status: 'done',
        autoResult: { status: 'active', evidence: 'computed evidence' },
      },
    });
    expect(screen.getByText(/auto: active.*you marked: done/i)).toBeInTheDocument();
  });

  it('renders "Clear override" button only when an override is active', () => {
    renderDrawer({
      result: {
        status: 'done',
        autoResult: { status: 'active' },
      },
    });
    expect(
      screen.getByRole('button', { name: /clear override/i }),
    ).toBeInTheDocument();
  });

  it('does not render Clear override when there is no override', () => {
    renderDrawer({ result: { status: 'active' } });
    expect(screen.queryByRole('button', { name: /clear override/i })).toBeNull();
  });

  it('closes when the backdrop is clicked', () => {
    const onOpenChange = vi.fn();
    renderDrawer({ result: { status: 'active' }, onOpenChange });
    fireEvent.click(screen.getByRole('dialog'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('opens the OverrideDialog when Override status is clicked', () => {
    renderDrawer({ result: { status: 'active' } });
    fireEvent.click(screen.getByRole('button', { name: /override status/i }));
    expect(
      screen.getByRole('heading', { name: /override status/i }),
    ).toBeInTheDocument();
  });
});
