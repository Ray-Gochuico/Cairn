import { formatCurrency } from '@/lib/format';
// Canonical result cell from Calculators Wave 0b (contract §2) — the base this
// row composes for its label+value core. Passed orientation="inline" (Wave 0b's
// 'stack'|'inline' prop, default 'stack') for the breakdown's label-left /
// amount-right layout. Paycheck-specific affordances (swatch, % of gross,
// variants, surtax tag, emptyNote) are layered on around it.
import { ResultRow } from '@/components/calculators/ResultRow';

export interface PaycheckBreakdownRowProps {
  label: string;
  /** Optional muted sublabel (e.g. "6.2% to wage base", "California"). */
  sublabel?: string;
  /** Annual amount for this line (already divided to the display period by the page). */
  amount: number;
  /** Denominator for the % column (the display-period gross). 0 hides the %. */
  grossForPct: number;
  /** Swatch color (hex or CSS var). */
  color: string;
  /** When true, render the amount in the negative/destructive treatment with a leading "–". */
  negative?: boolean;
  /** Visual variant: a divider-topped subtotal, or the bold total row. */
  variant?: 'normal' | 'subtotal' | 'total';
  /** When true, show the italic amber "+0.9% surtax" tag (Additional Medicare). */
  showAdditionalMedicareTag?: boolean;
  /**
   * When set, replaces the amount/% with italic muted text
   * (e.g. "(no state income tax)").
   */
  emptyNote?: string;
}

/**
 * One row of the Paycheck Calculator breakdown table. Mirrors the mockup's
 * .bd-row ($ amount + % of gross, optional Additional-Medicare tag, optional
 * italic "(no … tax)"). Uses semantic Tailwind tokens, not the mockup's hex.
 *
 * EXTENDS the canonical `ResultRow` (Calculators Wave 0b — contract §2): the
 * label+amount core is rendered through `ResultRow` with `orientation="inline"`
 * (Wave 0b's 'stack'|'inline' prop, default 'stack') so the swatch/label group
 * is its `label` and the formatted, tone-adjusted amount is its right-aligned
 * `value` — label-left / amount-right, the layout this breakdown table needs —
 * while keeping the canonical muted-label / `tabular-nums` / `emphasis`
 * treatment. The paycheck-specific extras — the color swatch, the `% of gross`
 * column, the `subtotal`/`total` row variants, the Additional-Medicare surtax
 * tag, and the italic "(no … tax)" empty state — are layered around that shared
 * cell. This row is NOT a forked parallel result-cell.
 */
export default function PaycheckBreakdownRow({
  label,
  sublabel,
  amount,
  grossForPct,
  color,
  negative = false,
  variant = 'normal',
  showAdditionalMedicareTag = false,
  emptyNote,
}: PaycheckBreakdownRowProps) {
  const pct = grossForPct > 0 ? (amount / grossForPct) * 100 : 0;
  const rowBorder =
    variant === 'total'
      ? 'border-t-2 mt-1 pt-3'
      : variant === 'subtotal'
        ? 'border-t'
        : 'border-b';
  const amountTone =
    variant === 'total'
      ? 'text-success-foreground'
      : negative
        ? 'text-destructive-soft-foreground'
        : 'text-foreground';

  // The swatch + label (+ sublabel + surtax tag) become the ResultRow `label`.
  const labelNode = (
    <span className="flex items-center gap-2.5 min-w-0">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0">
        {label}
        {sublabel && <span className="block text-[11px] text-muted-foreground">{sublabel}</span>}
        {showAdditionalMedicareTag && (
          <span className="ml-1.5 inline-block rounded border border-warning/40 bg-warning-soft px-1 text-[10px] italic text-warning-foreground align-middle">
            +0.9% surtax
          </span>
        )}
      </span>
    </span>
  );

  // The formatted, tone-adjusted amount becomes the ResultRow `value`.
  const valueNode = emptyNote ? (
    <span className="text-[12px] italic text-muted-foreground">{emptyNote}</span>
  ) : (
    <span className={`text-right ${amountTone}`}>
      {negative && amount > 0 ? '–' : ''}
      {formatCurrency(amount)}
    </span>
  );

  // Compose the canonical cell for the label/amount pairing, then append the
  // `% of gross` column. `orientation="inline"` (Wave 0b) gives ResultRow its
  // label-left / amount-right shape, so the cell already lays its label and
  // value horizontally; we sit it next to the % column to complete the row.
  return (
    <div
      className={`grid grid-cols-[1fr_auto] items-center gap-2.5 py-2 text-sm ${rowBorder}`}
    >
      <ResultRow
        label={labelNode}
        value={valueNode}
        orientation="inline"
        emphasis={variant === 'total'}
      />
      <span className="min-w-[48px] text-right text-[12px] tabular-nums text-muted-foreground">
        {!emptyNote && grossForPct > 0 ? `${pct.toFixed(1)}%` : ''}
      </span>
    </div>
  );
}
