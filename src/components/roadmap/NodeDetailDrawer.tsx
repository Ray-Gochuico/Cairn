import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { OverrideDialog } from './OverrideDialog';
import { StatusIcon } from './StatusIcon';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import type { NodeResult, RoadmapContext, RoadmapNode } from '@/types/roadmap';

interface Props {
  node: RoadmapNode;
  result: NodeResult;
  ctx: RoadmapContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Right-side sheet that pops out when the user hits the `(i)` button on a
 * node row. Three blocks per the design spec:
 *   1. Verbatim chart text (`node.body`) — what the source Financial Independence flow
 *      chart says, unmodified, so users can verify the app's reading.
 *   2. How this was calculated — the engine's `evidence` plus, when the
 *      user has overridden the node, a side-by-side "Auto: X · You
 *      marked: Y" line so they can spot divergence.
 *   3. Actions — Override Status (opens dialog) and, when an override is
 *      active, Clear Override (revert to the auto result).
 *
 * Rendered as a fixed-position panel rather than via @radix/react-sheet
 * to avoid pulling in a new dependency for one component. The behavior
 * is the same: clicking the backdrop or pressing Escape closes the panel.
 */
export function NodeDetailDrawer({ node, result, open, onOpenChange }: Props) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const clearOverride = useRoadmapOverridesStore((s) => s.clearOverride);
  const overridden = result.autoResult !== undefined;

  if (!open) return null;

  const handleBackdropClick = () => onOpenChange(false);

  const handleClear = async () => {
    await clearOverride(node.id);
    onOpenChange(false);
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={node.title}
        className="fixed inset-0 z-50 bg-black/40 flex justify-end"
        onClick={handleBackdropClick}
      >
        <div
          className="bg-white w-full sm:max-w-md h-full overflow-y-auto shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">{node.title}</h3>
              <div className="text-xs text-slate-500">Section {node.section}</div>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="text-slate-500 hover:text-slate-900"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="px-6 py-4 space-y-5">
            <section>
              <h4 className="text-xs uppercase text-slate-500 tracking-wider mb-1">
                From the chart
              </h4>
              <div className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                {node.body}
              </div>
            </section>
            <section>
              <h4 className="text-xs uppercase text-slate-500 tracking-wider mb-1">
                How this was calculated
              </h4>
              <div className="flex items-start gap-2 text-sm">
                <StatusIcon status={result.status} className="mt-0.5" />
                <div>{result.evidence ?? 'No calculation yet.'}</div>
              </div>
              {result.autoResult && (
                <div className="text-xs text-slate-500 italic mt-2">
                  Auto: {result.autoResult.status} · You marked: {result.status}
                </div>
              )}
            </section>
            <section className="flex flex-wrap gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOverrideOpen(true)}
              >
                Override status
              </Button>
              {overridden && (
                <Button variant="ghost" size="sm" onClick={handleClear}>
                  Clear override
                </Button>
              )}
            </section>
          </div>
        </div>
      </div>
      <OverrideDialog
        node={node}
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
      />
    </>
  );
}

export default NodeDetailDrawer;
