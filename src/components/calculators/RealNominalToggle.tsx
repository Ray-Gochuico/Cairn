import { cn } from '@/lib/utils';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import type { ChartDisplayMode } from '@/lib/calculators/use-chart-display-mode';

interface RealNominalToggleProps {
  mode: ChartDisplayMode;
  onChange: (mode: ChartDisplayMode) => void;
}

const BTN_BASE = 'px-2 py-0.5 text-xs transition-colors';
const BTN_ACTIVE = 'bg-primary text-primary-foreground';
const BTN_INACTIVE = '';

/** Per-card chart Nominal/Real switch. The glossary tooltip is a sibling label
 *  (TermTooltip renders its own <button>) — never wrap the toggle buttons. */
export function RealNominalToggle({ mode, onChange }: RealNominalToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">
        <TermTooltip term="NOMINAL VS REAL">Dollars</TermTooltip>
      </span>
      <div role="group" aria-label="Dollar display mode" className="inline-flex rounded border overflow-hidden">
        <button
          type="button"
          aria-pressed={mode === 'NOMINAL'}
          onClick={() => onChange('NOMINAL')}
          className={cn(BTN_BASE, mode === 'NOMINAL' ? BTN_ACTIVE : BTN_INACTIVE)}
        >
          Nominal
        </button>
        <button
          type="button"
          aria-pressed={mode === 'REAL'}
          onClick={() => onChange('REAL')}
          className={cn(BTN_BASE, 'border-l', mode === 'REAL' ? BTN_ACTIVE : BTN_INACTIVE)}
        >
          Real
        </button>
      </div>
    </div>
  );
}
