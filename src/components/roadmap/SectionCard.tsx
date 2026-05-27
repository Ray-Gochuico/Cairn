import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { NodeRow } from './NodeRow';
import { getGlossaryEntry } from '@/lib/glossary';
import type { NodeId, NodeResult, RoadmapContext, RoadmapNode } from '@/types/roadmap';

interface Props {
  section: number;
  title: string;
  /**
   * Optional glossary lookup key. When set, the section's collapse-toggle
   * button carries a native `title` attribute sourced from
   * src/lib/glossary.ts — mirrors the Sidebar / InputsLayout pattern.
   * Avoids nesting a TermTooltip button inside the toggle button (which
   * would be invalid HTML and would steal clicks).
   */
  glossaryTerm?: string;
  nodes: ReadonlyArray<RoadmapNode>;
  results: ReadonlyMap<NodeId, NodeResult>;
  ctx: RoadmapContext;
}

/**
 * Collapsible card for one section of the Roadmap. Header shows the
 * section number, title, an `X/Y` progress label (counting `done` over
 * non-info nodes), and an active indicator (`→`) when any node in the
 * section is on the user's current path. Auto-expands whenever an active
 * node appears so the user always lands on the right section without
 * hunting.
 *
 * `info`-status nodes are excluded from the X/Y denominator because they
 * are informational (chart relays, branch headers) and never move
 * through `done` — counting them would make sections feel permanently
 * stuck below 100%.
 */
export function SectionCard({ section, title, glossaryTerm, nodes, results, ctx }: Props) {
  const glossaryEntry = glossaryTerm ? getGlossaryEntry(glossaryTerm) : null;
  const counts = nodes.reduce(
    (acc, n) => {
      const s = results.get(n.id)?.status ?? 'not-started';
      if (s !== 'info') acc.total += 1;
      if (s === 'done') acc.done += 1;
      if (s === 'active') acc.active = true;
      return acc;
    },
    { done: 0, total: 0, active: false },
  );

  const hasActive = counts.active;
  const [open, setOpen] = useState(hasActive);
  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  const progressIndicator = hasActive
    ? ' →'
    : counts.total > 0 && counts.done === counts.total
    ? ' ✓'
    : ' ·';

  return (
    <Card>
      <button
        type="button"
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`section-${section}-body`}
        title={glossaryEntry?.shortDefinition}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase text-muted-foreground tracking-wider">
            Section {section}
          </span>
          <span className="font-semibold">{title}</span>
          {glossaryEntry && (
            <span aria-hidden className="text-xs text-muted-foreground">
              &#9432;
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span aria-label="progress">
            {counts.done}/{counts.total}
            {progressIndicator}
          </span>
          {open ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </div>
      </button>
      {open && (
        <div
          id={`section-${section}-body`}
          className="px-4 py-3 border-t space-y-2"
        >
          {nodes.map((n) => (
            <NodeRow
              key={n.id}
              node={n}
              result={results.get(n.id) ?? { status: 'not-started' }}
              ctx={ctx}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

export default SectionCard;
