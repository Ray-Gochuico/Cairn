import { cn } from '@/lib/utils';
import type { Person } from '@/types/schema';
// B2 (D-B2-9): the shared class pair; the person-list render stays (values are number | null).
import { SEG_BTN_ACTIVE, SEG_BTN_BASE, SEG_GROUP } from '@/components/ui/segmented-control';

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
  /** Label for the Combined segment (default 'Combined'; the page-scope
   *  control renames it 'Household' — Wave B CB1). */
  combinedLabel?: string;
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
  combinedLabel = 'Combined',
}: EarnerSelectProps) {
  if (persons.length < 2) return null;
  return (
    <div role="group" aria-label={label} className={SEG_GROUP}>
      {includeCombined && (
        <button
          type="button"
          aria-pressed={selectedId === null}
          onClick={() => onChange(null)}
          className={cn(SEG_BTN_BASE, selectedId === null ? SEG_BTN_ACTIVE : '')}
        >
          {combinedLabel}
        </button>
      )}
      {persons.map((p, i) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={p.id === selectedId}
          onClick={() => onChange(p.id!)}
          className={cn(SEG_BTN_BASE, (i > 0 || includeCombined) && 'border-l', p.id === selectedId ? SEG_BTN_ACTIVE : '')}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
