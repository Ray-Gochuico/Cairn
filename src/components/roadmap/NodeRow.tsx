import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { StatusIcon } from './StatusIcon';
import { DecisionPrompt } from './DecisionPrompt';
import { NodeDetailDrawer } from './NodeDetailDrawer';
import type { NodeResult, RoadmapContext, RoadmapNode } from '@/types/roadmap';

interface Props {
  node: RoadmapNode;
  result: NodeResult;
  ctx: RoadmapContext;
}

/**
 * Single node row inside a SectionCard. Shows the status icon, title,
 * one-line evidence, an optional CTA link, and an inline decision prompt
 * for `unanswered` nodes. The `(i)` button on the right opens the
 * NodeDetailDrawer with verbatim chart text + calculation breakdown.
 *
 * Override-indicator: when the engine overrides the displayed status
 * (autoResult side channel populated), we show "(overridden)" next to
 * the title so the user does not forget they pinned this.
 */
export function NodeRow({ node, result, ctx }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const overridden = result.autoResult !== undefined;
  const skipped = result.status === 'skipped';

  return (
    <>
      <div className="flex items-start gap-2 py-1.5">
        <StatusIcon status={result.status} className="mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div
            className={`text-sm font-medium ${skipped ? 'line-through text-muted-foreground' : ''}`}
          >
            {node.title}
            {overridden && (
              <span className="ml-2 text-xs text-muted-foreground italic">
                (overridden)
              </span>
            )}
          </div>
          {result.evidence && (
            <div className="text-xs text-muted-foreground">{result.evidence}</div>
          )}
          {result.cta && (
            <Link
              to={result.cta.href}
              className="text-xs text-info-foreground hover:underline mt-1 inline-block"
            >
              {result.cta.label}
            </Link>
          )}
          {result.question && <DecisionPrompt question={result.question} />}
        </div>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label={`Details for ${node.title}`}
        >
          <Info className="h-4 w-4" />
        </button>
      </div>
      <NodeDetailDrawer
        node={node}
        result={result}
        ctx={ctx}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}

export default NodeRow;
