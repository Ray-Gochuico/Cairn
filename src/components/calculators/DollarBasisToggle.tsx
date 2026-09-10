import { cn } from '@/lib/utils';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { CALCULATORS_PAGE_ID, useDollarBasis } from '@/lib/calculators/dollar-basis';

const BTN_BASE = 'px-2 py-0.5 text-xs transition-colors';
const BTN_ACTIVE = 'bg-primary text-primary-foreground';

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
      <div
        role="group"
        aria-label="Dollar basis"
        className="inline-flex rounded border overflow-hidden"
      >
        <button
          type="button"
          aria-pressed={basis === 'today'}
          onClick={() => setBasis('today')}
          className={cn(BTN_BASE, basis === 'today' ? BTN_ACTIVE : '')}
        >
          Today&#39;s $
        </button>
        <button
          type="button"
          aria-pressed={basis === 'future'}
          onClick={() => setBasis('future')}
          className={cn(BTN_BASE, 'border-l', basis === 'future' ? BTN_ACTIVE : '')}
        >
          Future $
        </button>
      </div>
      {/* m8: the bar serves every section — name what this control governs. */}
      {scopeNote != null && (
        <span className="text-xs text-muted-foreground" data-testid="dollar-basis-scope-note">
          {scopeNote}
        </span>
      )}
    </div>
  );
}
