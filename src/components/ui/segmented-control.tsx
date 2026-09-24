import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ── v1.7.0 B2 (chip task_e1ab8035): THE segmented control. These three
      strings were seven verbatim copies (SEG_BTN_* in PathToFi / StressTest /
      SupplementalPay / ReturnSourceControl; BTN_* in DollarBasisToggle /
      EarnerSelect / SupplementalMethodToggle). One definition, one aria and
      keyboard contract (tests/components/ui/segmented-control.test.tsx). The
      constants are exported for EarnerSelect, whose dynamic person list keeps
      its own render (D-B2-9). ──────────────────────────────────────────── */

export const SEG_GROUP = 'inline-flex rounded border overflow-hidden';
export const SEG_BTN_BASE = 'px-2 py-0.5 text-xs transition-colors';
export const SEG_BTN_ACTIVE = 'bg-primary text-primary-foreground';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  /** The group's accessible name (`aria-label`). */
  label: string;
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  /** Fires on EVERY activation, the already-pressed option included — the
   *  landed behavior of every copy; callers are idempotent (D-B2-8). */
  onChange: (value: T) => void;
  /** Extra root classes (`self-start` for rail-mounted controls). */
  className?: string;
}

/**
 * The house mode-switch idiom: `role="group"` + native `<button aria-pressed>`
 * per option. Every option is a natural tab stop (no roving tabindex — this is
 * the toggle-button-group pattern, not a radiogroup); Enter / Space activate
 * through the native button. Fully controlled: `value` in, `onChange` out.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className={cn(SEG_GROUP, className)}>
      {options.map((opt, i) => {
        const pressed = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(opt.value)}
            className={cn(SEG_BTN_BASE, i > 0 && 'border-l', pressed && SEG_BTN_ACTIVE)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
