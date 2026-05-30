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
    transactions: [],
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
    renderDrawer({
      result: { status: 'active' },
      open: false,
    });
    // Sheet is closed → Radix unmounts the Portal/Content, so no dialog
    // role is in the DOM.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the three sections: chart text, calculation, actions', () => {
    renderDrawer({ result: { status: 'active', evidence: '2 loans ≥ 8%' } });
    // Section headings render as uppercase short labels.
    expect(
      screen.getByRole('heading', { name: /^from the developer.s paraphrase$/i }),
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

  it('closes when Escape is pressed', () => {
    // shadcn Sheet (Radix Dialog) handles Escape natively — replaces the
    // pre-refactor click-backdrop test, which doesn't apply cleanly when
    // the overlay sits in a portal sibling. The Escape contract is what
    // matters for the focus-trap promise.
    const onOpenChange = vi.fn();
    renderDrawer({ result: { status: 'active' }, onOpenChange });
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
      code: 'Escape',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('exposes a dialog role with the node title as the accessible name', () => {
    // Sheet content is rendered into a portal as role="dialog". The
    // accessible name comes from <SheetTitle> via aria-labelledby; we
    // also keep aria-label as a belt-and-suspenders fallback so screen
    // readers in either mode announce the node title.
    renderDrawer({ result: { status: 'active' } });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // The node title from makeNode() shows up in the dialog header.
    expect(
      screen.getByRole('heading', { name: /capture the full employer match/i }),
    ).toBeInTheDocument();
  });

  it('opens the OverrideDialog when Override status is clicked', () => {
    renderDrawer({ result: { status: 'active' } });
    fireEvent.click(screen.getByRole('button', { name: /override status/i }));
    expect(
      screen.getByRole('heading', { name: /override status/i }),
    ).toBeInTheDocument();
  });
});
