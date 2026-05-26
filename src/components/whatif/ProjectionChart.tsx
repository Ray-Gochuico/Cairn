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

const AREA_COLORS = ['#4f86f7', '#5fbb7c', '#e6b54b', '#ef8b5a', '#9b5de5', '#f15bb5'];

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
            <XAxis dataKey="monthISO" tick={{ fontSize: 11 }} minTickGap={32} />
            <YAxis
              tick={{ fontSize: 11 }}
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
                      fill="#4f86f7"
                      fillOpacity={0.25}
                      isAnimationActive={false}
                    />
                  )}
                  {detailLevel === ProjectionDetailLevel.TAX_BUCKET && (
                    <>
                      <Area
                        type="monotone"
                        dataKey={`taxAdvantaged_${scId}`}
                        name="Tax-advantaged"
                        stackId="composition"
                        stroke="none"
                        fill="#9b5de5"
                        fillOpacity={0.25}
                        isAnimationActive={false}
                      />
                      <Area
                        type="monotone"
                        dataKey={`taxable_${scId}`}
                        name="Taxable"
                        stackId="composition"
                        stroke="none"
                        fill="#4f86f7"
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
                          fill={AREA_COLORS[idx % AREA_COLORS.length]}
                          fillOpacity={0.25}
                          isAnimationActive={false}
                        />
                      );
                    })}
                  <Area
                    type="monotone"
                    dataKey={`homeEquity_${scId}`}
                    name="Home equity"
                    stackId="composition"
                    stroke="none"
                    fill="#5fbb7c"
                    fillOpacity={0.25}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey={`cash_${scId}`}
                    name="Cash"
                    stackId="composition"
                    stroke="none"
                    fill="#e6b54b"
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

      <div className="w-full" style={{ height: 110 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={lowerRows} margin={{ top: 4, right: 16, bottom: 16, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="monthISO" tick={{ fontSize: 11 }} minTickGap={32} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={formatCompactCurrency}
              width={72}
              domain={[(dataMin: number) => Math.max(0, dataMin * 0.8), 'auto']}
            />
            <Tooltip
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
                  style={{ backgroundColor: AREA_COLORS[idx % AREA_COLORS.length] }}
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
