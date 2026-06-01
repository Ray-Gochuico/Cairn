import { cn } from '@/lib/utils';
import type { SupplementalMethod } from '@/lib/calculators/use-supplemental-method';

interface SupplementalMethodToggleProps {
  method: SupplementalMethod;
  onChange: (method: SupplementalMethod) => void;
}

const BTN_BASE = 'px-2 py-0.5 text-xs transition-colors';
const BTN_ACTIVE = 'bg-primary text-primary-foreground';

/** Segmented control: federal supplemental-wage method (Aggregate vs Flat 22%). */
export function SupplementalMethodToggle({ method, onChange }: SupplementalMethodToggleProps) {
  return (
    <div role="group" aria-label="Withholding method" className="inline-flex rounded border overflow-hidden">
      <button
        type="button"
        aria-pressed={method === 'AGGREGATE'}
        onClick={() => onChange('AGGREGATE')}
        className={cn(BTN_BASE, method === 'AGGREGATE' ? BTN_ACTIVE : '')}
      >
        Aggregate
      </button>
      <button
        type="button"
        aria-pressed={method === 'FLAT'}
        onClick={() => onChange('FLAT')}
        className={cn(BTN_BASE, 'border-l', method === 'FLAT' ? BTN_ACTIVE : '')}
      >
        Flat 22%
      </button>
    </div>
  );
}
