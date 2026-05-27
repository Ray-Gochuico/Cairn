import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
 * Built on shadcn `<Sheet>` (W7-Frontend RM-3 — previously a hand-rolled
 * fixed-position panel that lacked focus trap, animated slide-in, and
 * Escape-key wiring outside of click-outside). The Sheet primitive is
 * backed by `@radix-ui/react-dialog`, which gives us:
 *   • focus trapped while the drawer is open
 *   • Escape closes
 *   • click-outside closes (via the Sheet's overlay)
 *   • inert background while open
 *   • animated slide-in / slide-out from the right side
 */
export function NodeDetailDrawer({ node, result, open, onOpenChange }: Props) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const clearOverride = useRoadmapOverridesStore((s) => s.clearOverride);
  const overridden = result.autoResult !== undefined;

  const handleClear = async () => {
    await clearOverride(node.id);
    onOpenChange(false);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          aria-label={node.title}
          className="w-full sm:max-w-md overflow-y-auto p-0"
        >
          <SheetHeader className="px-6 py-4 border-b text-left space-y-1">
            <SheetTitle className="text-base font-semibold">
              {node.title}
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Section {node.section}
            </SheetDescription>
          </SheetHeader>
          <div className="px-6 py-4 space-y-5">
            <section>
              <h4 className="text-xs uppercase text-muted-foreground tracking-wider mb-1">
                From the chart
              </h4>
              <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                {node.body}
              </div>
            </section>
            <section>
              <h4 className="text-xs uppercase text-muted-foreground tracking-wider mb-1">
                How this was calculated
              </h4>
              <div className="flex items-start gap-2 text-sm">
                <StatusIcon status={result.status} className="mt-0.5" />
                <div>{result.evidence ?? 'No calculation yet.'}</div>
              </div>
              {result.autoResult && (
                <div className="text-xs text-muted-foreground italic mt-2">
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
        </SheetContent>
      </Sheet>
      <OverrideDialog
        node={node}
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
      />
    </>
  );
}

export default NodeDetailDrawer;
