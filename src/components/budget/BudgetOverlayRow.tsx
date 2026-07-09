import type { BudgetRow } from '@/lib/budget-analysis';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/format';

export interface BudgetOverlayRowProps {
  row: BudgetRow;
  onBudgetCommit?: (
    categoryId: number,
    raw: string,
    inputEl: HTMLInputElement,
    savedBudget: number | null,
  ) => void;
}

export default function BudgetOverlayRow({ row, onBudgetCommit }: BudgetOverlayRowProps) {
  const { categoryId, categoryName, budget, actual, remaining, overBudget } = row;

  // Fill ratio: 0..1 (capped). Unbudgeted rows render an empty track.
  const fillRatio =
    budget != null && budget > 0
      ? Math.min(actual / budget, 1)
      : 0;
  const fillPct = `${Math.round(fillRatio * 100)}%`;

  // Fill color tracks state — green for under, red/pink for over, transparent
  // when no spending so the muted track shows through.
  const fillColor = overBudget
    ? 'bg-destructive'
    : actual > 0
      ? 'bg-success'
      : 'bg-transparent';

  // Right-side label — "$X over" (red) when over, "$X left" (green when there
  // is real spending, muted when actual = 0) otherwise. Hidden for unbudgeted.
  const showLabel = budget != null && remaining != null;
  const labelText = overBudget
    ? `${formatCurrency(Math.abs(remaining as number))} over`
    : `${formatCurrency(Math.abs(remaining as number))} left`;
  const labelColor = overBudget
    ? 'text-destructive-soft-foreground'
    : actual > 0
      ? 'text-success-foreground'
      : 'text-muted-foreground';

  return (
    <div className="grid grid-cols-[10rem_7rem_1fr_auto] items-center gap-3 py-2">
      <div className="text-sm font-medium">{categoryName}</div>

      {onBudgetCommit ? (
        <Input
          type="number"
          step="1"
          min="0"
          className="h-8 w-24 tabular-nums"
          aria-label={`Budget for ${categoryName}`}
          defaultValue={budget ?? ''}
          onBlur={(e) =>
            onBudgetCommit(categoryId, e.target.value, e.target, budget)
          }
        />
      ) : (
        // W10 M7: with no commit handler (the synthetic "Misc" catch-all has no
        // category row to write), render a STATIC value — never an editable
        // input that silently discards every edit on blur.
        <span className="text-sm tabular-nums text-muted-foreground">
          {budget != null ? formatCurrency(Math.abs(budget)) : '—'}
        </span>
      )}

      <div>
        <div
          className="relative h-3 w-full overflow-hidden rounded-full bg-muted"
          data-testid="budget-overlay-track"
        >
          <div
            data-testid="budget-overlay-fill"
            className={`absolute left-0 top-0 h-full rounded-full transition-all ${fillColor}`}
            style={{ width: fillPct }}
          />
        </div>
        {budget != null && (
          <div className="mt-1 text-xs text-muted-foreground tabular-nums">
            {formatCurrency(Math.abs(actual))} of {formatCurrency(Math.abs(budget))}
          </div>
        )}
      </div>

      {showLabel ? (
        <div className={`text-sm font-medium tabular-nums ${labelColor}`}>
          {labelText}
        </div>
      ) : (
        <div />
      )}
    </div>
  );
}
