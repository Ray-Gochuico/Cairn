import { SWATCH_OPTIONS } from '@/components/charts/palette';

interface ColorSwatchPickerProps {
  /** The currently selected hex, or null for "use the default". */
  value: string | null;
  /** Called with the picked hex, or null when the Default tile is chosen. */
  onChange: (next: string | null) => void;
  /** Optional caption rendered above the grid. */
  label?: string;
}

/**
 * A 30-swatch color picker plus a "Default" tile. Hand-written (not a
 * shadcn primitive) and built from plain <button> elements — no Radix,
 * so it stays clear of jsdom's Radix pointer-event pitfalls in tests.
 * The selected swatch (or the Default tile when value is null) carries
 * aria-pressed and a ring indicator.
 */
export function ColorSwatchPicker({ value, onChange, label }: ColorSwatchPickerProps) {
  return (
    <div className="space-y-2">
      {label && <div className="text-sm font-medium">{label}</div>}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-label="Default color"
          aria-pressed={value === null}
          onClick={() => onChange(null)}
          className={`flex h-7 w-7 items-center justify-center rounded-md border text-[10px] text-muted-foreground ${
            value === null ? 'ring-2 ring-ring ring-offset-1' : ''
          }`}
        >
          Def
        </button>
        {SWATCH_OPTIONS.map((hex) => (
          <button
            key={hex}
            type="button"
            aria-label={`Color ${hex}`}
            aria-pressed={value === hex}
            onClick={() => onChange(hex)}
            style={{ background: hex }}
            className={`h-7 w-7 rounded-md border ${
              value === hex ? 'ring-2 ring-ring ring-offset-1' : ''
            }`}
          >
            {value === hex && (
              <span aria-hidden="true" className="text-xs font-bold text-white">
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
