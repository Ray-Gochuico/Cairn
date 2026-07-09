import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * House dollar-entry field (Wave 11): "$" prefix, raw digits while focused,
 * thousands separators on blur, right-aligned tabular numerals. The model
 * value is a plain number (or null for empty) — no formatting ever reaches
 * the store. type="text" + inputMode="decimal" because a formatted value
 * ("300,000") is not a valid <input type="number"> value.
 */
type Props = Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: number | null;
  onValueChange: (v: number | null) => void;
};

const fmt = (n: number): string =>
  n.toLocaleString('en-US', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

export function MoneyInput({ value, onValueChange, className, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  const display =
    focused && draft !== null ? draft : value === null ? '' : focused ? String(value) : fmt(value);

  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
      >
        $
      </span>
      <Input
        {...rest}
        type="text"
        inputMode="decimal"
        className={cn('pl-7 text-right tabular-nums', className)}
        value={display}
        onFocus={(e) => {
          setFocused(true);
          setDraft(value === null ? '' : String(value));
          rest.onFocus?.(e);
        }}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9.]/g, '');
          setDraft(raw);
          if (raw === '') onValueChange(null);
          else {
            const n = Number(raw);
            if (Number.isFinite(n)) onValueChange(n);
          }
        }}
        onBlur={(e) => {
          setFocused(false);
          setDraft(null);
          rest.onBlur?.(e);
        }}
      />
    </div>
  );
}
