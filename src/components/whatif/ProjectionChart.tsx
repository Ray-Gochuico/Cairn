import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  ComposedChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
} from 'recharts';
import React from 'react';
import type { Scenario } from '@/types/scenario';
import type { Account } from '@/types/schema';
import type { MonthlyState, Milestones } from '@/lib/scenarios';
import { toReal, totalInvestments, aggregateByTaxBucket } from '@/lib/scenarios';
import { taxBucketForAccount } from '@/lib/account-tax-classification';
import { ProjectionDetailLevel } from '@/types/enums';
import { formatCompactCurrency } from '@/lib/format';
import { DecomposedTooltipContent } from './ProjectionTooltip';
import { CHART_TOOLTIP_PROPS } from '@/components/charts/ChartTooltip';
import { CHART_PALETTE } from '@/components/charts/palette';

/**
 * Named-fill assignments for the upper pane's composition Areas.
 *
 * Picked from CHART_PALETTE so the chart shares the same Vega category10
 * palette as every other chart in the app (Donut, Bar, Line, sector and
 * per-account series). Index choices: blue/green/yellow track the
 * canonical money/wealth/cash mental model, purple is reserved for the
 * tax-advantaged bucket so it stays distinct from blue (taxable). The
 * per-account stack reuses CHART_PALETTE directly via `paletteAt`.
 *
 * Note: these are palette-token hexes — they are theme-stable because
 * the palette is a single source of truth, but they don't switch with
 * .dark. Recharts paints SVG fills using hex/HSL strings and Tailwind
 * class names don't resolve inside `fill=` props, so we read the palette
 * as static values. Dark-mode legibility is preserved because the area
 * fillOpacity is 0.25 (the palette tints sit on a near-black canvas).
 */
const INVESTMENTS_FILL    = CHART_PALETTE[0]; // blue
const HOME_EQUITY_FILL    = CHART_PALETTE[4]; // green
const CASH_FILL           = CHART_PALETTE[5]; // yellow
const TAX_ADVANTAGED_FILL = CHART_PALETTE[6]; // purple
const TAXABLE_FILL        = CHART_PALETTE[0]; // blue
const paletteAt = (i: number) => CHART_PALETTE[i % CHART_PALETTE.length];

export interface ProjectionChartProps {
  scenarios: Scenario[];
  projections: Map<number, MonthlyState[]>;
  milestones: Map<number, Milestones>;
  dollarMode: 'nominal' | 'real';
  inflation: number;
  startISO: string;
  detailLevel: ProjectionDetailLevel;
  accounts: Account[];
}

interface Row {
  monthISO: string;
  [seriesKey: string]: string | number;
}

function deriveDisplayProjections(
  projections: Map<number, MonthlyState[]>,
  dollarMode: 'nominal' | 'real',
  inflation: number,
  startISO: string,
): Map<number, MonthlyState[]> {
  if (dollarMode === 'nominal') return projections;
  const out = new Map<number, MonthlyState[]>();
  for (const [id, states] of projections) {
    out.set(id, toReal(states, inflation, startISO));
  }
  return out;
}

function buildUpperPaneRows(
  scenarios: Scenario[],
  display: Map<number, MonthlyState[]>,
  accounts: Account[],
  detailLevel: ProjectionDetailLevel,
): Row[] {
  const visible = scenarios.filter((s) => s.visible && s.id != null);
  if (visible.length === 0) return [];
  const spine = display.get(visible[0].id!);
  if (!spine) return [];
  return spine.map((step, i) => {
    const row: Row = { monthISO: step.monthISO };
    for (const sc of visible) {
      const arr = display.get(sc.id!);
      if (!arr || !arr[i]) continue;
      const state = arr[i];
      row[`net_${sc.id}`] = state.netWorth;
      row[`homeEquity_${sc.id}`]  = state.homeEquity;
      row[`cash_${sc.id}`]        = state.cash;

      if (detailLevel === ProjectionDetailLevel.SINGLE) {
        row[`investments_${sc.id}`] = totalInvestments(state);
      } else if (detailLevel === ProjectionDetailLevel.TAX_BUCKET) {
        const agg = aggregateByTaxBucket(state, accounts);
        row[`taxAdvantaged_${sc.id}`] = agg.taxAdvantaged;
        row[`taxable_${sc.id}`] = agg.taxable;
      } else {
        // per_account
        for (const acct of accounts) {
          if (acct.id == null) continue;
          if (taxBucketForAccount(acct) === null) continue;
          row[`acct_${acct.id}_${sc.id}`] = state.investmentsByAccount[acct.id] ?? 0;
        }
      }
    }
    return row;
  });
}

function buildLowerPaneRows(scenarios: Scenario[], display: Map<number, MonthlyState[]>): Row[] {
  const visible = scenarios.filter((s) => s.visible && s.id != null);
  if (visible.length === 0) return [];
  const spine = display.get(visible[0].id!);
  if (!spine) return [];
  return spine.map((step, i) => {
    const row: Row = { monthISO: step.monthISO };
    for (const sc of visible) {
      const arr = display.get(sc.id!);
      if (!arr || !arr[i]) continue;
      row[`debt_${sc.id}`] = Object.values(arr[i].debtByLoan).reduce((a, b) => a + b, 0);
    }
    return row;
  });
}

export default function ProjectionChart({
  scenarios,
  projections,
  milestones,
  dollarMode,
  inflation,
  startISO,
  detailLevel,
  accounts,
}: ProjectionChartProps) {
  const visible = scenarios.filter((s) => s.visible);
  const mode: 'composition' | 'lines' = visible.length === 1 ? 'composition' : 'lines';

  const display = useMemo(
    () => deriveDisplayProjections(projections, dollarMode, inflation, startISO),
    [projections, dollarMode, inflation, startISO],
  );
  const upperRows = useMemo(
    () => buildUpperPaneRows(scenarios, display, accounts, detailLevel),
    [scenarios, display, accounts, detailLevel],
  );
  const lowerRows = useMemo(() => buildLowerPaneRows(scenarios, display), [scenarios, display]);

  // Wave-5 design A+ #2 / Wave-3 W3-3 follow-up: in TAX_BUCKET mode,
  // Recharts emits ~48 `width(-1) and height(-1)` warnings per render when
  // the bucket areas have no non-zero values across any row. The page-level
  // `hasProjectionData` guard catches the truly-empty case (no scenarios /
  // no rows) but a household with 1 person + 0 investment accounts still
  // produces non-empty rows (cash + homeEquity + net worth), so the bucket
  // Areas mount and fail to lay out. Gate the bucket Areas on actual
  // non-zero bucket data — when none, fall back to the SINGLE detail-level
  // view (cash + home equity + net worth line), which lays out correctly.
  // This mirrors the empty-state pattern used at the WhatIf page level.
  const hasBucketData = useMemo(() => {
    if (detailLevel !== ProjectionDetailLevel.TAX_BUCKET) return true;
    for (const row of upperRows) {
      for (const key of Object.keys(row)) {
        if (!key.startsWith('taxAdvantaged_') && !key.startsWith('taxable_')) continue;
        if (typeof row[key] === 'number' && (row[key] as number) > 0) return true;
      }
    }
    return false;
  }, [detailLevel, upperRows]);

  // Item 25 follow-up: the lower-pane debt chart suffers the same
  // Recharts width(-1)/height(-1) console-warning storm as the
  // tax-bucket areas when there are no debts to draw (no loans, or
  // every loan balance has already amortized to zero). The page-level
  // `hasProjectionData` guard in WhatIf.tsx mounts the chart whenever
  // any projection rows exist — but rows do exist for households with
  // 0 loans (debt_${id} just stays 0 across the whole spine), so the
  // <ComposedChart> mounts with all-zero series and Recharts can't lay
  // out the y-axis. Mirror the upper-pane guard: compute a single
  // boolean over `lowerRows` and skip the lower pane entirely when
  // every debt series is zero. We still render the divider + an empty
  // hint so the layout below the upper chart stays predictable for
  // tests + screenshots.
  const hasDebtData = useMemo(() => {
    if (lowerRows.length === 0) return false;
    for (const row of lowerRows) {
      for (const key of Object.keys(row)) {
        if (!key.startsWith('debt_')) continue;
        if (typeof row[key] === 'number' && (row[key] as number) > 0) return true;
      }
    }
    return false;
  }, [lowerRows]);

  // Investment accounts (non-cash/savings) used by the per-account view.
  // Sorted by name (then id) so the checkbox row + chart series stack are stable.
  const investmentAccounts = useMemo(
    () =>
      accounts
        .filter((a) => a.id != null && taxBucketForAccount(a) !== null)
        .slice()
        .sort((a, b) => {
          const byName = a.name.localeCompare(b.name);
          return byName !== 0 ? byName : (a.id ?? 0) - (b.id ?? 0);
        }),
    [accounts],
  );

  // Session-only per-account visibility filter for the per-account view.
  // Stored as a Set of hidden account ids — defaulting to empty means every
  // account is visible. Mirrors Track 3's FI pills inline override and Track 2's
  // SWR pill: no persistence (Settings → Advanced controls the default detail
  // level; this is a finer-grained transient view filter).
  const [hiddenAccountIds, setHiddenAccountIds] = useState<Set<number>>(() => new Set());

  // Reset visibility when the set of investment-account ids changes (user added
  // / removed an account in Inputs). Identity-stable signature so we don't reset
  // on every render.
  const accountIdSignature = useMemo(
    () =>
      investmentAccounts
        .map((a) => a.id)
        .filter((id): id is number => id != null)
        .sort((a, b) => a - b)
        .join(','),
    [investmentAccounts],
  );
  useEffect(() => {
    setHiddenAccountIds(new Set());
  }, [accountIdSignature]);

  const toggleAccountVisibility = (id: number) => {
    setHiddenAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const hideAll = () => {
    setHiddenAccountIds(
      new Set(investmentAccounts.map((a) => a.id).filter((id): id is number => id != null)),
    );
  };
  const showAll = () => setHiddenAccountIds(new Set());

  // The per-account checkbox row only makes sense in PER_ACCOUNT mode AND when
  // we're rendering areas (single-scenario composition mode). Multi-scenario
  // "lines only" mode hides the row because no per-account areas are drawn.
  const showAccountToggleRow =
    detailLevel === ProjectionDetailLevel.PER_ACCOUNT &&
    mode === 'composition' &&
    investmentAccounts.length > 0;
  const allHidden =
    investmentAccounts.length > 0 &&
    investmentAccounts.every((a) => a.id != null && hiddenAccountIds.has(a.id));

  const milestoneRefLines = scenarios
    .filter((sc) => sc.visible && sc.id != null)
    .flatMap((sc) => {
      const m = milestones.get(sc.id!);
      if (!m) return [];
      const out: React.ReactNode[] = [];
      if (m.debtFreeISO) {
        out.push(
          <ReferenceLine
            key={`df_${sc.id}`}
            x={m.debtFreeISO}
            stroke={sc.color}
            strokeDasharray="4 4"
            label={{ value: 'Debt-free', position: 'top', fill: sc.color, fontSize: 11 }}
          />,
        );
      }
      if (m.financialIndependenceISO) {
        out.push(
          <ReferenceLine
            key={`fi_${sc.id}`}
            x={m.financialIndependenceISO}
            stroke={sc.color}
            strokeDasharray="2 6"
            label={{ value: 'FI', position: 'top', fill: sc.color, fontSize: 11 }}
          />,
        );
      }
      if (m.retirementISO) {
        out.push(
          <ReferenceLine
            key={`retire_${sc.id}`}
            x={m.retirementISO}
            stroke={sc.color}
            strokeDasharray="1 3"
            label={{ value: 'Retire', position: 'top', fill: sc.color, fontSize: 11 }}
          />,
        );
      }
      return out;
    });

  const milestoneRefLinesLower = scenarios
    .filter((sc) => sc.visible && sc.id != null)
    .flatMap((sc) => {
      const m = milestones.get(sc.id!);
      if (!m) return [];
      const out: React.ReactNode[] = [];
      if (m.debtFreeISO) {
        out.push(
          <ReferenceLine
            key={`df_lower_${sc.id}`}
            x={m.debtFreeISO}
            stroke={sc.color}
            strokeDasharray="4 4"
          />,
        );
      }
      if (m.financialIndependenceISO) {
        out.push(
          <ReferenceLine
            key={`fi_lower_${sc.id}`}
            x={m.financialIndependenceISO}
            stroke={sc.color}
            strokeDasharray="2 6"
          />,
        );
      }
      if (m.retirementISO) {
        out.push(
          <ReferenceLine
            key={`retire_lower_${sc.id}`}
            x={m.retirementISO}
            stroke={sc.color}
            strokeDasharray="1 3"
          />,
        );
      }
      return out;
    });

  return (
    <div data-testid="whatif-projection-chart" className="w-full">
      <span data-testid="whatif-chart-mode" className="sr-only">{mode}</span>

      <div className="w-full" style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={upperRows} margin={{ top: 16, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="monthISO" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} minTickGap={32} />
            <YAxis
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={formatCompactCurrency}
              width={72}
              domain={[(dataMin: number) => Math.max(0, dataMin * 0.8), 'auto']}
            />
            {/* Task #25 — replace the single-number tooltip with a per-
                scenario decomposition (compound vs auto-invested salary vs
                lever contributions vs lump sums vs withdrawals). Driven by
                a named-export content function so tests can call it directly
                with a synthetic payload (recharts tooltips don't render well
                in jsdom). */}
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              isAnimationActive={false}
              content={(p) => (
                <DecomposedTooltipContent
                  label={p.label}
                  active={p.active}
                  scenarios={scenarios}
                  displayProjections={display}
                />
              )}
            />

            {mode === 'composition' && visible.length === 1 && visible[0]?.id != null && (() => {
              const sc = visible[0]!;
              const scId = sc.id!;
              return (
                <>
                  {detailLevel === ProjectionDetailLevel.SINGLE && (
                    <Area
                      type="monotone"
                      dataKey={`investments_${scId}`}
                      name="Investments"
                      stackId="composition"
                      stroke="none"
                      fill={INVESTMENTS_FILL}
                      fillOpacity={0.25}
                      isAnimationActive={false}
                    />
                  )}
                  {detailLevel === ProjectionDetailLevel.TAX_BUCKET && hasBucketData && (
                    <>
                      <Area
                        type="monotone"
                        dataKey={`taxAdvantaged_${scId}`}
                        name="Tax-advantaged"
                        stackId="composition"
                        stroke="none"
                        fill={TAX_ADVANTAGED_FILL}
                        fillOpacity={0.25}
                        isAnimationActive={false}
                      />
                      <Area
                        type="monotone"
                        dataKey={`taxable_${scId}`}
                        name="Taxable"
                        stackId="composition"
                        stroke="none"
                        fill={TAXABLE_FILL}
                        fillOpacity={0.25}
                        isAnimationActive={false}
                      />
                    </>
                  )}
                  {detailLevel === ProjectionDetailLevel.PER_ACCOUNT &&
                    investmentAccounts.map((acct, idx) => {
                      if (acct.id == null || hiddenAccountIds.has(acct.id)) return null;
                      return (
                        <Area
                          key={`acct_${acct.id}`}
                          type="monotone"
                          dataKey={`acct_${acct.id}_${scId}`}
                          name={acct.name}
                          stackId="composition"
                          stroke="none"
                          fill={paletteAt(idx)}
                          fillOpacity={0.25}
                          isAnimationActive={false}
                        />
                      );
                    })}
                  <Area
                    type="monotone"
                    dataKey={`homeEquity_${scId}`}
                    name="Property & vehicles"
                    stackId="composition"
                    stroke="none"
                    fill={HOME_EQUITY_FILL}
                    fillOpacity={0.25}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey={`cash_${scId}`}
                    name="Cash"
                    stackId="composition"
                    stroke="none"
                    fill={CASH_FILL}
                    fillOpacity={0.25}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey={`net_${scId}`}
                    name={`${sc.name} net worth`}
                    stroke={sc.color}
                    strokeWidth={2.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </>
              );
            })()}

            {mode === 'lines' &&
              visible.map((sc) => (
                <Line
                  key={`net_${sc.id}`}
                  type="monotone"
                  dataKey={`net_${sc.id}`}
                  name={sc.name}
                  stroke={sc.color}
                  strokeDasharray={sc.lineStyle === 'dashed' ? '6 4' : undefined}
                  strokeWidth={sc.isActive ? 2.5 : 1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}

            {milestoneRefLines}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="border-t my-2" aria-hidden />

      {hasDebtData ? (
        <div
          className="w-full"
          style={{ height: 110 }}
          data-testid="whatif-debt-chart"
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={lowerRows} margin={{ top: 4, right: 16, bottom: 16, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="monthISO" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} minTickGap={32} />
              <YAxis
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={formatCompactCurrency}
                width={72}
                domain={[(dataMin: number) => Math.max(0, dataMin * 0.8), 'auto']}
              />
              <Tooltip
                {...CHART_TOOLTIP_PROPS}
                formatter={(value, name) => [formatCompactCurrency(Number(value)), String(name)]}
                labelFormatter={(label) => String(label ?? '')}
                cursor={{ strokeDasharray: '3 3' }}
              />
              {visible.map((sc) => (
                <Line
                  key={`debt_${sc.id}`}
                  type="monotone"
                  dataKey={`debt_${sc.id}`}
                  name={`${sc.name} debt`}
                  stroke={sc.color}
                  strokeDasharray={sc.lineStyle === 'dashed' ? '6 4' : undefined}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}

              {milestoneRefLinesLower}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div
          className="text-xs text-muted-foreground px-1 py-2"
          data-testid="whatif-debt-chart-empty"
        >
          No debt to project.
        </div>
      )}

      {/* W10 design: the TAX_BUCKET stacked bands were unexplained color — a
          static swatch row (matching the PER_ACCOUNT idiom) names them. */}
      {detailLevel === ProjectionDetailLevel.TAX_BUCKET && hasBucketData && (
        <div data-testid="tax-bucket-legend" className="flex flex-wrap items-center gap-4 mt-2 text-xs text-muted-foreground">
          {[
            { label: 'Tax-advantaged', fill: TAX_ADVANTAGED_FILL },
            { label: 'Taxable', fill: TAXABLE_FILL },
          ].map(({ label, fill }) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: fill, opacity: 0.6 }} />
              {label}
            </span>
          ))}
        </div>
      )}

      {showAccountToggleRow && (
        <div
          data-testid="whatif-account-toggle-row"
          className="flex flex-wrap items-center gap-3 mt-2 text-sm"
        >
          <button
            type="button"
            onClick={allHidden ? showAll : hideAll}
            className="text-xs font-medium text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            data-testid="whatif-account-toggle-all"
          >
            {allHidden ? 'Show all' : 'Hide all'}
          </button>
          {investmentAccounts.map((acct, idx) => {
            if (acct.id == null) return null;
            const id = acct.id;
            const inputId = `whatif-account-toggle-${id}`;
            const checked = !hiddenAccountIds.has(id);
            return (
              <label
                key={id}
                htmlFor={inputId}
                className="flex items-center gap-1.5 cursor-pointer select-none"
                data-testid={`whatif-account-toggle-label-${id}`}
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleAccountVisibility(id)}
                  className="h-3.5 w-3.5 rounded border-border accent-foreground cursor-pointer"
                  data-testid={`whatif-account-toggle-${id}`}
                />
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: paletteAt(idx) }}
                />
                <span className={checked ? '' : 'text-muted-foreground line-through'}>
                  {acct.name}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
