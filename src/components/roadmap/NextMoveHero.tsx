import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { NODES } from '@/domain/roadmap/nodes';
import type { NodeId, NodeResult } from '@/types/roadmap';

/**
 * Hero card surfacing the user's single most relevant next action. Picks
 * the first `active` node in section order; falls back to a "caught up"
 * card when nothing is active. Reused by the Dashboard's `<NextMoveCard />`
 * in Sub-Plan D.
 */
export function NextMoveHero({ results }: { results: ReadonlyMap<NodeId, NodeResult> }) {
  const sorted = [...NODES].sort((a, b) => a.section - b.section);
  const active = sorted.find((n) => results.get(n.id)?.status === 'active');

  if (!active) {
    return (
      <Card className="p-4 bg-emerald-50 border-emerald-200">
        <div className="text-xs uppercase text-emerald-700 tracking-wider">
          Your next move
        </div>
        <div className="text-lg font-semibold mt-1">You&rsquo;re caught up</div>
        <div className="text-sm text-slate-600 mt-1">
          Review the sections below or revisit your inputs.
        </div>
      </Card>
    );
  }

  const result = results.get(active.id)!;
  return (
    <Card className="p-4 bg-blue-50 border-blue-200">
      <div className="text-xs uppercase text-blue-700 tracking-wider">
        Your next move
      </div>
      <div className="text-lg font-semibold mt-1">{active.title}</div>
      {result.evidence && (
        <div className="text-sm text-slate-600 mt-1">{result.evidence}</div>
      )}
      {result.cta && (
        <Link
          to={result.cta.href}
          className="text-sm text-blue-700 underline mt-2 inline-block"
        >
          {result.cta.label}
        </Link>
      )}
    </Card>
  );
}

export default NextMoveHero;
