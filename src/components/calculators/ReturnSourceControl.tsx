import { cn } from '@/lib/utils';
import {
  RETURN_SOURCE_ASSUMED_LABEL,
  RETURN_SOURCE_GROUP_LABEL,
  RETURN_SOURCE_HISTORY_LABEL,
} from '@/lib/calculators/history-fan-copy';
import type { ChartReturnSource } from '@/lib/calculators/use-chart-source';

const SEG_BTN_BASE = 'px-2 py-0.5 text-xs transition-colors';
const SEG_BTN_ACTIVE = 'bg-primary text-primary-foreground';

interface ReturnSourceControlProps {
  /** The EFFECTIVE source (gate-safe) — never the raw stored value. */
  source: ChartReturnSource;
  onAssumed: () => void;
  onHistory: () => void;
}

/** CH-7 / D-UB3: the Assumed | History segmented control — the usePathMode
 *  mode-switch idiom (role="group" + aria-pressed), rail-mounted in
 *  RailViewGroup. A return-source choice, NOT a dollar-basis choice — W5
 *  owns the word "basis" and the page-level DollarBasisToggle. */
export function ReturnSourceControl({ source, onAssumed, onHistory }: ReturnSourceControlProps) {
  return (
    <div
      role="group"
      aria-label={RETURN_SOURCE_GROUP_LABEL}
      className="inline-flex self-start rounded border overflow-hidden"
    >
      <button
        type="button"
        aria-pressed={source === 'ASSUMED'}
        onClick={onAssumed}
        className={cn(SEG_BTN_BASE, source === 'ASSUMED' ? SEG_BTN_ACTIVE : '')}
      >
        {RETURN_SOURCE_ASSUMED_LABEL}
      </button>
      <button
        type="button"
        aria-pressed={source === 'HISTORY'}
        onClick={onHistory}
        className={cn(SEG_BTN_BASE, 'border-l', source === 'HISTORY' ? SEG_BTN_ACTIVE : '')}
      >
        {RETURN_SOURCE_HISTORY_LABEL}
      </button>
    </div>
  );
}
