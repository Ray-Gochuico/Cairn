import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { useHouseholdStore } from '@/stores/household-store';
import { useDisclosureGate } from '@/legal/useDisclosureGate';
import { useRoadmap } from '@/domain/roadmap/context';
import { evaluate } from '@/domain/roadmap/evaluate';
import { NODES } from '@/domain/roadmap/nodes';

/**
 * Compact Dashboard widget surfacing the Roadmap's current next move.
 * Reuses the same evaluation pipeline as the full Roadmap page; the
 * only logic the card itself owns is which state to render:
 *
 *   1. household == null      → "Finish setting up" — CTA to /setup
 *   2. disclosure gate open   → "Set up your roadmap" — CTA to /roadmap
 *   3. no active node         → "You're caught up" — link to roadmap
 *   4. has active node        → render that node's title + evidence + CTA
 *
 * Surfaces "ⓘ N unanswered question(s)" alongside the CTA when there
 * are nodes the engine cannot score until the user answers a prompt.
 * The link routes back to the Roadmap so they can answer inline.
 */
export function NextMoveCard() {
  const household = useHouseholdStore((s) => s.household);
  const gate = useDisclosureGate('roadmap');
  const ctx = useRoadmap();
  const results = useMemo(() => (ctx ? evaluate(ctx) : new Map()), [ctx]);

  if (!household) {
    return (
      <Card className="p-4">
        <div className="text-xs uppercase text-slate-500 tracking-wider">
          Your next move
        </div>
        <div className="text-sm text-slate-700 mt-1">
          Finish setting up to see your next move.
        </div>
        <Link
          to="/setup"
          className="text-sm text-blue-700 underline mt-2 inline-block"
        >
          Continue Setup →
        </Link>
      </Card>
    );
  }

  if (gate.state === 'needs-acceptance') {
    return (
      <Card className="p-4">
        <div className="text-xs uppercase text-slate-500 tracking-wider">
          Your next move
        </div>
        <div className="text-sm font-medium mt-1">Set up your roadmap</div>
        <div className="text-xs text-slate-600">
          See where you stand on the FIRE flow chart.
        </div>
        <Link
          to="/roadmap"
          className="text-sm text-blue-700 underline mt-2 inline-block"
        >
          Open Roadmap →
        </Link>
      </Card>
    );
  }

  const sorted = [...NODES].sort((a, b) => a.section - b.section);
  const active = sorted.find((n) => results.get(n.id)?.status === 'active');
  const unanswered = sorted.filter(
    (n) => results.get(n.id)?.status === 'unanswered',
  ).length;

  if (!active) {
    return (
      <Card className="p-4 bg-emerald-50 border-emerald-200">
        <div className="text-xs uppercase text-emerald-700 tracking-wider flex items-center justify-between">
          <span>Your next move</span>
          <Link to="/roadmap" className="text-xs underline">
            View →
          </Link>
        </div>
        <div className="text-sm font-semibold mt-1">You're caught up</div>
        {unanswered > 0 && (
          <Link
            to="/roadmap"
            className="text-xs text-amber-700 mt-2 inline-block"
          >
            ⓘ {unanswered} unanswered question{unanswered === 1 ? '' : 's'}
          </Link>
        )}
      </Card>
    );
  }

  const result = results.get(active.id)!;
  return (
    <Card className="p-4 bg-blue-50 border-blue-200">
      <div className="text-xs uppercase text-blue-700 tracking-wider flex items-center justify-between">
        <span>Your next move</span>
        <Link to="/roadmap" className="text-xs underline">
          View →
        </Link>
      </div>
      <div className="text-sm font-semibold mt-1">{active.title}</div>
      {result.evidence && (
        <div className="text-xs text-slate-700 mt-1">{result.evidence}</div>
      )}
      <div className="mt-2 flex items-center gap-3">
        {result.cta && (
          <Link
            to={result.cta.href}
            className="text-sm text-blue-700 underline"
          >
            {result.cta.label}
          </Link>
        )}
        {unanswered > 0 && (
          <Link to="/roadmap" className="text-xs text-amber-700">
            ⓘ {unanswered} unanswered question{unanswered === 1 ? '' : 's'}
          </Link>
        )}
      </div>
    </Card>
  );
}

export default NextMoveCard;
