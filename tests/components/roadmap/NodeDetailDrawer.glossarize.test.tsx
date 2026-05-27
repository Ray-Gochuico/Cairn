import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  NodeDetailDrawer,
  glossarize,
} from '@/components/roadmap/NodeDetailDrawer';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import type { NodeResult, RoadmapContext, RoadmapNode } from '@/types/roadmap';
import type { Household } from '@/types/schema';
import { FilingStatus } from '@/types/enums';

/**
 * Wave-7 UX MF-3 — Roadmap node bodies route financial terms through
 * `<TermTooltip>`. These tests cover both the pure helper (so we can
 * lock down match semantics) and a mounted drawer (so we know the
 * terms make it into the DOM as tooltips for screen readers and
 * keyboard users).
 *
 * Match semantics under test:
 *   1. canonical acronyms (HDHP, HSA, FICA, ...) get wrapped
 *   2. spelled-out aliases fold into the canonical glossary key
 *      (e.g. "Modified Adjusted Gross Income" → MAGI)
 *   3. only the first occurrence per term is wrapped; later occurrences
 *      stay as plain text so the prose isn't a wall of underlines
 *   4. longest-match wins (solo-401(k) is one tooltip, not two)
 *   5. unknown terms pass through unchanged (no UI nag, just no wrap)
 */

function makeNode(body: string): RoadmapNode {
  return {
    id: 's3_hdhp_branch',
    section: 3,
    kind: 'action',
    title: 'Choose an HSA-qualified HDHP',
    body,
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
    transactions: [],
    overrides: new Map(),
    thresholds: { low: 5, high: 8 },
    taxYear: 2026,
    today: new Date('2026-05-28T00:00:00Z'),
  };
}

function renderDrawer(body: string, result: NodeResult = { status: 'active' }) {
  return render(
    <NodeDetailDrawer
      node={makeNode(body)}
      result={result}
      ctx={makeCtx()}
      open
      onOpenChange={() => {}}
    />,
  );
}

describe('glossarize (Roadmap node body helper)', () => {
  it('wraps a single known term in a TermTooltip-shaped trigger', () => {
    const parts = glossarize('Contribute to HSA via HDHP');
    // parts is a mix of strings and ReactElements; assert we got at
    // least one element (TermTooltip) — DOM assertions are exercised
    // by the mounted-drawer tests below.
    const elements = parts.filter((p) => typeof p !== 'string');
    expect(elements.length).toBeGreaterThanOrEqual(2); // HSA + HDHP
  });

  it('returns a single-string array when the text has no known terms', () => {
    const parts = glossarize('Plain narrative with no financial jargon at all.');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe('Plain narrative with no financial jargon at all.');
  });
});

describe('NodeDetailDrawer body glossarize', () => {
  beforeEach(() => {
    useRoadmapOverridesStore.setState({
      overridesByNodeId: new Map(),
      isLoading: false,
      error: null,
      load: async () => {},
      setOverride: vi.fn().mockResolvedValue(undefined),
      clearOverride: vi.fn().mockResolvedValue(undefined),
    } as never);
  });

  it('wraps HDHP and HSA in the body — both render as tooltip triggers', () => {
    renderDrawer('Contribute to HSA via HDHP');
    // TermTooltip renders the literal text inside a <button> whose
    // sibling is the ⓘ icon. The button has the trigger class
    // "decoration-dotted" — match by the literal text and assert
    // the parent is a button (the trigger).
    const hsa = screen.getByText('HSA');
    expect(hsa.closest('button')).not.toBeNull();
    const hdhp = screen.getByText('HDHP');
    expect(hdhp.closest('button')).not.toBeNull();
  });

  it('folds "Modified Adjusted Gross Income" into the MAGI glossary entry', () => {
    renderDrawer('Compute your Modified Adjusted Gross Income.');
    const trigger = screen.getByText('Modified Adjusted Gross Income');
    expect(trigger.closest('button')).not.toBeNull();
  });

  it('first-occurrence-only — repeat HSA stays as plain text', () => {
    renderDrawer('First HSA mention, then a second HSA mention.');
    // The wrapped occurrence sits inside a button trigger.
    const triggers = screen.getAllByRole('button', { name: /^HSA$/ });
    expect(triggers).toHaveLength(1);
    // The second "HSA" lives inside a plain text node that is *not* a
    // button. Scan the dialog body for the full surrounding phrase and
    // confirm the second mention isn't wrapped.
    const body = screen
      .getByRole('heading', { name: /from the chart/i })
      .closest('section')!;
    // ⓘ trigger icon and tooltip popover may interpose characters around
    // the wrapped term — just confirm both "HSA" mentions are still in
    // the section text overall.
    expect(body.textContent).toMatch(/First HSA/);
    expect(body.textContent).toMatch(/second HSA/);
    // The number of trigger buttons that contain "HSA" should equal 1
    // even though the text is in the DOM twice.
    const allHsaButtons = Array.from(body.querySelectorAll('button')).filter(
      (b) => b.textContent?.includes('HSA'),
    );
    expect(allHsaButtons).toHaveLength(1);
  });

  it('binds "solo-401(k)" as one tooltip, not nested as 401(k)', () => {
    renderDrawer('Open a solo-401(k) to clear pre-tax IRA balance.');
    // The full literal "solo-401(k)" is the button child — assert no
    // separate "401(k)" trigger fights for the substring.
    const trigger = screen.getByText('solo-401(k)');
    expect(trigger.closest('button')).not.toBeNull();
    // The bare "401(k)" pattern should not also have hit.
    expect(screen.queryByText('401(k)')).toBeNull();
  });

  it('wraps a sampling of in-scope terms together (HDHP / FICA / pro-rata / 529 / IPS / ESPP)', () => {
    renderDrawer(
      'Your HDHP unlocks an HSA; payroll HSA contributions also escape FICA. ' +
        'Backdoor conversions trigger the pro-rata rule if you hold SEP balances. ' +
        '529 plans support education savings, including a SECURE 2.0 Roth rollover. ' +
        'Write an IPS in calm conditions. ESPP discounts can vest same-day.',
    );
    for (const literal of [
      'HDHP',
      'HSA',
      'FICA',
      'pro-rata',
      'SEP',
      '529',
      'SECURE 2.0',
      'IPS',
      'ESPP',
    ]) {
      const node = screen.getByText(literal);
      expect(
        node.closest('button'),
        `expected "${literal}" to be inside a TermTooltip trigger`,
      ).not.toBeNull();
    }
  });
});
