import type { BacktestResult } from '@/lib/backtest';
import { formatCompactCurrency } from '@/lib/format';
import { SHILLER_DATA_AS_OF } from '@/data/shiller';

interface Props { result: BacktestResult; goalAmount: number; }

export function OutcomeSummary({ result, goalAmount }: Props) {
  const total = result.startYears.count;
  const pct = total > 0 ? (result.goalMetCount / total) * 100 : 0;
  return (
    <div data-testid="backtest-summary" className="space-y-3">
      {/* Success hero: text-success-foreground (NOT text-success, ~2.30:1 on
          light — AA fail even at this large size's 3:1 bar, and fails badly as
          the page's headline figure). text-success-foreground on the page
          --background clears AA on both themes: light 5.46:1 / dark 15.39:1. */}
      <div className="text-5xl font-bold text-success-foreground tabular-nums">{Math.round(pct)}%</div>
      {/* UX F3 (BT-8) — run-meta caption directly under the headline hero: what
          this run covered (period count · goal · real dollars · data span). */}
      <div data-testid="backtest-run-meta" className="text-xs text-muted-foreground">
        {total} historical periods · goal {formatCompactCurrency(goalAmount)} · real dollars · 1871–{SHILLER_DATA_AS_OF}
      </div>
      <div className="text-sm">
        <strong>{result.goalMetCount} of {total}</strong> historical periods ended at or
        above your <strong>{formatCompactCurrency(goalAmount)}</strong> goal.
      </div>
      <div className="h-2 rounded bg-muted overflow-hidden">
        <span className="block h-full bg-success" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-muted-foreground">
        This is a <strong>count of past outcomes</strong>, not a probability of future
        success. By the looser &ldquo;just don&rsquo;t run out&rdquo; test:{' '}
        <strong>{result.survivedCount} of {total}</strong> survived.
      </div>
      <div className="grid grid-cols-3 gap-2">
        {/* Worst-ending dollar figure: --chart-danger (NOT text-destructive,
            which is ~1.82:1 on dark bg-muted/40 — AA fail, near-invisible).
            --chart-danger has NO Tailwind utility (text-chart-danger is a DEAD
            class), so it MUST be an inline style. As TEXT on bg-muted/40 it
            clears AA on both themes: light 4.63:1 / dark 5.20:1. Matches the
            worst LINE color in the chart (BT-5 cohesion). */}
        <Tile label="Worst ending" value={formatCompactCurrency(result.endings.worst.value)}
          meta={`started ${result.endings.worst.startYear}${result.endings.worst.depletedYear ? ` · depleted yr ${result.endings.worst.depletedYear}` : ''}`}
          valueStyle={{ color: 'hsl(var(--chart-danger))' }} />
        <Tile label="Median ending" value={formatCompactCurrency(result.endings.median)}
          meta={`across ${total} starts`} tone="" />
        {/* Best-ending: text-success-foreground (NOT text-success, ~2.22:1 on
            light bg-muted/40 — AA fail). text-success-foreground on bg-muted/40
            clears AA on both themes: light 5.27:1 / dark 14.0:1. */}
        <Tile label="Best ending" value={formatCompactCurrency(result.endings.best.value)}
          meta={`started ${result.endings.best.startYear}`} tone="text-success-foreground" />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  meta,
  tone = '',
  valueStyle,
}: {
  label: string;
  value: string;
  meta: string;
  // `tone` for tokens with a Tailwind utility (e.g. text-success-foreground).
  // `valueStyle` for tokens WITHOUT one (e.g. --chart-danger, whose
  // text-chart-danger class does not exist) — pass an inline style instead.
  tone?: string;
  valueStyle?: React.CSSProperties;
}) {
  return (
    <div className="rounded-md border bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone}`} style={valueStyle}>{value}</div>
      <div className="text-xs text-muted-foreground">{meta}</div>
    </div>
  );
}
