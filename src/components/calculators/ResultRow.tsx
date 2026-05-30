import type { ReactNode } from 'react';

interface ResultRowProps {
  label: ReactNode;
  value: ReactNode;
  testId?: string;
  /** Heavier value weight for the primary line (net / total). */
  emphasis?: boolean;
  /**
   * Layout of the label vs. value. `'stack'` (default) is the calculator-card
   * cell — a muted label OVER a tabular-nums value. `'inline'` is the
   * label-left / value-right row the v1.1 paycheck plan's `PaycheckBreakdownRow`
   * composes inside its breakdown grid. SHARED CONTRACT — Paycheck passes
   * `orientation="inline"`; keep these literals stable.
   */
  orientation?: 'stack' | 'inline';
}

/**
 * The canonical calculator result cell. This is the base the v1.1 paycheck
 * plan's `PaycheckBreakdownRow` consumes — do not fork a parallel result-cell
 * component. `'stack'` keeps the 3 calculator cards byte-identical (default);
 * `'inline'` is the horizontal label-left / value-right variant Paycheck needs.
 */
export function ResultRow({
  label,
  value,
  testId,
  emphasis = false,
  orientation = 'stack',
}: ResultRowProps) {
  const valueClass = `tabular-nums ${emphasis ? 'font-semibold' : 'font-medium'}`;

  if (orientation === 'inline') {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span data-testid={testId} className={valueClass}>
          {value}
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div data-testid={testId} className={valueClass}>
        {value}
      </div>
    </div>
  );
}
