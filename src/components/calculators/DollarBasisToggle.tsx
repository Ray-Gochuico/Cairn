import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { CALCULATORS_PAGE_ID, useDollarBasis } from '@/lib/calculators/dollar-basis';
import type { DollarBasis } from '@/lib/calculators/dollar-basis';

const BASIS_OPTIONS: ReadonlyArray<SegmentedOption<DollarBasis>> = [
  { value: 'today', label: "Today's $" },
  { value: 'future', label: 'Future $' },
];

/** C4 — the calculators bar governs 2 of its cards, so it names them (m8). */
export const CALCULATORS_SCOPE_NOTE = 'Applies to Path to FI & Compound Interest';

export interface DollarBasisToggleProps {
  /** Which page's basis this control drives (D-T2: one store, keyed per page). */
  pageId?: string;
  /** m8 scope note. `null` renders none — for a control that is page furniture
   *  governing every figure on its page (W5.1: /what-if, D-W51-6). */
  scopeNote?: string | null;
}

/**
 * W5 (D-T1/D-T9): THE page-level Today's $/Future $ control — replaces the
 * per-card Nominal/Real switch deleted in D-T9. Renders in the ScenarioBar's
 * identity row beside the scope control (both are lenses: neither touches
 * overrides or editedCount). W5.1 makes it page-parametric so /what-if mounts
 * the SAME control (one vocabulary, one store); the no-prop render is
 * byte-identical to the landed /calculators one.
 * The glossary tooltip is a sibling label (TermTooltip renders its own
 * <button>) — never wrap the toggle buttons.
 */
export function DollarBasisToggle({
  pageId = CALCULATORS_PAGE_ID,
  scopeNote = CALCULATORS_SCOPE_NOTE,
}: DollarBasisToggleProps = {}) {
  const [basis, setBasis] = useDollarBasis(pageId);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">
        <TermTooltip term="NOMINAL VS REAL">Dollar basis</TermTooltip>
      </span>
      <SegmentedControl label="Dollar basis" options={BASIS_OPTIONS} value={basis} onChange={setBasis} />
      {/* m8: the bar serves every section — name what this control governs. */}
      {scopeNote != null && (
        <span className="text-xs text-muted-foreground" data-testid="dollar-basis-scope-note">
          {scopeNote}
        </span>
      )}
    </div>
  );
}
