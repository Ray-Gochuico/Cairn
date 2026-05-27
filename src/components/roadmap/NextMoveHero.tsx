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
      <Card className="p-4 bg-success-soft border-success/30">
        <div className="text-xs uppercase text-success-foreground tracking-wider">
          Your next move
        </div>
        <div className="text-lg font-semibold mt-1">You&rsquo;re caught up</div>
        <div className="text-sm text-muted-foreground mt-1">
          Review the sections below or revisit your inputs.
        </div>
      </Card>
    );
  }

  const result = results.get(active.id)!;
  return (
    <Card className="p-4 bg-info-soft border-info/30">
      <div className="text-xs uppercase text-info-foreground tracking-wider">
        Your next move
      </div>
      <div className="text-lg font-semibold mt-1">{active.title}</div>
      {result.evidence && (
        <div className="text-sm text-muted-foreground mt-1">{result.evidence}</div>
      )}
      {result.cta && (
        <Link
          to={result.cta.href}
          className="text-sm text-info-foreground underline mt-2 inline-block"
        >
          {result.cta.label}
        </Link>
      )}
    </Card>
  );
}

export default NextMoveHero;
