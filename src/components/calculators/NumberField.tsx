import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface NumberFieldProps {
  id: string;
  /** Visual label — accepts any ReactNode (e.g. a TermTooltip-wrapped string).
   *  The `<Label htmlFor={id}>` association gives the `<Input>` its accessible
   *  name via the label element. When the visible label is non-string (e.g.
   *  contains an icon), pass `ariaLabel` as a plain string fallback to also set
   *  `aria-label` directly on the input so AT can always surface a flat name. */
  label: ReactNode;
  /** Optional plain-string aria-label set directly on the `<Input>`.
   *  Use when `label` is a ReactNode that doesn't reduce to a readable string. */
  ariaLabel?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  suffix?: string;
  step?: string;
  min?: number;
}

/**
 * Numeric input with the one safe parse idiom: empty string → null (the field
 * is blankable, no leading-zero artifacts), otherwise a parsed finite number.
 * Replaces the per-card `Number(e.target.value)` drift.
 */
export function NumberField({ id, label, ariaLabel, value, onChange, suffix, step = 'any', min }: NumberFieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          type="number"
          step={step}
          min={min}
          aria-label={ariaLabel}
          value={value === null ? '' : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(null);
            const n = Number(raw);
            if (!Number.isFinite(n)) return onChange(null);
            onChange(min != null ? Math.max(min, n) : n);
          }}
        />
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
