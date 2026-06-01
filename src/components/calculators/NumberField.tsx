import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface NumberFieldProps {
  id: string;
  label: string;
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
export function NumberField({ id, label, value, onChange, suffix, step = 'any', min }: NumberFieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          type="number"
          step={step}
          min={min}
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
