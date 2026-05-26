import { useMemo } from 'react';
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
  const investmentAccounts = useMemo(
    () => accounts.filter((a) => a.id != null && taxBucketForAccount(a) !== null),
    [accounts],
  );

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
            <YAxis tick={{ fontSize: 11 }} tickFormatter={formatCompactCurrency} width={72} />
            <Tooltip
              formatter={(value, name) => [formatCompactCurrency(Number(value)), String(name)]}
              labelFormatter={(label) => String(label ?? '')}
              cursor={{ strokeDasharray: '3 3' }}
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
                    investmentAccounts.map((acct, idx) => (
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
                    ))}
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
            <YAxis tick={{ fontSize: 11 }} tickFormatter={formatCompactCurrency} width={72} />
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
    </div>
  );
}
