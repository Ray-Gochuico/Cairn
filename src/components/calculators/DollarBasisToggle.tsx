import { cn } from '@/lib/utils';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { CALCULATORS_PAGE_ID, useDollarBasis } from '@/lib/calculators/dollar-basis';

const BTN_BASE = 'px-2 py-0.5 text-xs transition-colors';
const BTN_ACTIVE = 'bg-primary text-primary-foreground';

/**
 * W5 (D-T1/D-T9): THE one page-level Today's $/Future $ control — replaces
 * the per-card Nominal/Real switch deleted in D-T9. Renders in the ScenarioBar's
 * identity row beside the scope control (both are lenses: neither touches
 * overrides or
 * editedCount). The glossary tooltip is a sibling label (TermTooltip renders
 * its own <button>) — never wrap the toggle buttons.
 */
export function DollarBasisToggle() {
  const [basis, setBasis] = useDollarBasis(CALCULATORS_PAGE_ID);
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
      <span className="text-xs text-muted-foreground" data-testid="dollar-basis-scope-note">
        Applies to Path to FI &amp; Compound Interest
      </span>
    </div>
  );
}
