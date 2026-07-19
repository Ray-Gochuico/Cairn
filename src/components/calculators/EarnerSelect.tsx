import { cn } from '@/lib/utils';
import type { Person } from '@/types/schema';

const BTN_BASE = 'px-2 py-0.5 text-xs transition-colors';
const BTN_ACTIVE = 'bg-primary text-primary-foreground';

interface EarnerSelectProps {
  /** ELIGIBLE persons only — the caller filters (all persons for bonus /
   *  commission / 401k / paycheck; HOURLY|SALARY_WITH_OT for overtime). */
  persons: Person[];
  /** null = the Combined segment (only meaningful with includeCombined). */
  selectedId: number | null;
  onChange: (personId: number | null) => void;
  /** Accessible group name, e.g. "Who receives this bonus". */
  label: string;
  /** Prepend a "Combined" segment (Paycheck's household view — D16).
   *  Selecting it fires onChange(null). */
  includeCombined?: boolean;
}

/**
 * Segmented person picker (SupplementalMethodToggle idiom). Renders NOTHING
 * when fewer than 2 eligible persons — single-earner households never see it.
 * Drives whose SS wage base / §402(g) headroom / age the tax tools use.
 */
export function EarnerSelect({
  persons,
  selectedId,
  onChange,
  label,
  includeCombined = false,
}: EarnerSelectProps) {
  if (persons.length < 2) return null;
  return (
    <div role="group" aria-label={label} className="inline-flex rounded border overflow-hidden">
      {includeCombined && (
        <button
          type="button"
          aria-pressed={selectedId === null}
          onClick={() => onChange(null)}
          className={cn(BTN_BASE, selectedId === null ? BTN_ACTIVE : '')}
        >
          Combined
        </button>
      )}
      {persons.map((p, i) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={p.id === selectedId}
          onClick={() => onChange(p.id!)}
          className={cn(BTN_BASE, (i > 0 || includeCombined) && 'border-l', p.id === selectedId ? BTN_ACTIVE : '')}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
