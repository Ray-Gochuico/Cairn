import { useMemo } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { CalculatorCard } from './CalculatorCard';
import { financialIndependenceSeries } from '@/lib/financial-independence';
import { formatCurrency, formatPercent } from '@/lib/format';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { useCalculatorState } from '@/lib/calculator-state';
import { NumberField } from '@/components/calculators/NumberField';
import { sumLatestOnOrBefore } from '@/lib/growth-horizons';
import { effectiveSwr } from '@/lib/scenarios/effective-swr';
import { effectiveBaselineInflation } from '@/lib/scenarios/effective-inflation';
import LineChartCard from '@/components/charts/LineChartCard';
import { balanceTrajectory } from '@/lib/projection-trajectory';
import { toRealSeries } from '@/lib/calculators/real-mode';
import { RealNominalToggle } from '@/components/calculators/RealNominalToggle';
import { useChartDisplayMode } from '@/lib/calculators/use-chart-display-mode';
import { useSettingsStore } from '@/stores/settings-store';
import { CHART_PALETTE, CHART_NEUTRAL } from '@/components/charts/palette';

interface FinancialIndependenceCardProps {
  cardId?: string;
  onHide?: (cardId: string) => void;
}

export function FinancialIndependenceCard({
  cardId,
  onHide,
}: FinancialIndependenceCardProps = {}) {
  const { household } = useHouseholdStore();
  const persons = usePersonsStore((s) => s.persons);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const contributions = useContributionsStore((s) => s.contributions);

  // ── Real-data defaults (memoized from the stores) ──────────────────────────
  const defaults = useMemo(() => {
    // Latest snapshot per account on or before today — the canonical helper
    // (shared with What-If/Backtest). It applies the snapshotDate <= today
    // cutoff the old hand-rolled loop omitted.
    const todayIso = new Date().toISOString().slice(0, 10);
    const currentPortfolio = sumLatestOnOrBefore(snapshots, todayIso) ?? 0;

    // Rolling 12-month contribution total — used as the annual PMT figure for
    // the FV solver. We compare ISO date strings; chronological order matches
    // string order for YYYY-MM-DD.
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const isoYearAgo = oneYearAgo.toISOString().slice(0, 10);
    const annualContribution = contributions
      .filter((c) => c.date >= isoYearAgo)
      .reduce((sum, c) => sum + c.amount, 0);

    // No active scenario on the dashboard card → pass null; effectiveSwr derives
    // from household.withdrawalRate (when > 0) else the 0.04 canonical default.
    // Stored as a 0–100 percent and divided by 100 in the computation.
    const withdrawalRatePct = effectiveSwr(null, household) * 100;

    return {
      currentPortfolio,
      annualContribution,
      monthlyExpenses: household?.monthlyExpenseBaseline ?? 0,
      withdrawalRatePct,
    };
  }, [household, snapshots, contributions]);

  const { values, setValue, reset, isOverridden } = useCalculatorState(
    cardId ?? 'financial-independence',
    defaults,
  );

  // ── Chart display mode (Nominal/Real toggle) + inflation ───────────────────
  const [displayMode, setDisplayMode] = useChartDisplayMode(cardId ?? 'financial-independence');
  // N1/N3: resolve inflation through the app's CANONICAL chain
  // (household.inflationAssumption → settings.defaultInflation → 0.03) — the
  // SAME resolver the What-If FiCards use — so the dashboard and What-If
  // "years to FI" / "coast needed" numbers agree exactly for the same
  // household, and so the table/headline and the deflated chart share one
  // inflation figure. No active scenario on the dashboard → scenario = null.
  const settings = useSettingsStore((s) => s.settings);
  const inflation = effectiveBaselineInflation(null, household ?? null, settings);

  // ── Derived calculations (off the EDITED assumptions) ──────────────────────
  const targetFv = useMemo(() => {
    const swr = (values.withdrawalRatePct ?? 0) / 100;
    if (swr <= 0) return 0;
    return ((values.monthlyExpenses ?? 0) * 12) / swr;
  }, [values.monthlyExpenses, values.withdrawalRatePct]);

  const series = useMemo(() => {
    if (!household || persons.length === 0) return null;
    if (!household.growthScenarios || household.growthScenarios.length === 0)
      return null;
    // FI needs a positive target to compute (positive expenses + a positive
    // withdrawal rate). The SWR is editable, so a non-positive rate keeps the
    // card mounted (no rows) rather than empty-stating it.
    if ((values.monthlyExpenses ?? 0) <= 0) return null;
    if (targetFv <= 0) return null;

    // H1: targetFv is in today's dollars (real), but growthScenarios rates are
    // NOMINAL. Pass `inflation` so the years-to-FI solve converts each rate to
    // REAL first — otherwise a nominal balance reaches a real target too early
    // (optimistic). The result still carries the nominal rate for display/chart.
    return financialIndependenceSeries({
      pv: values.currentPortfolio,
      annualContribution: values.annualContribution,
      targetFv,
      scenarios: household.growthScenarios,
      inflation,
    });
  }, [
    household,
    persons,
    targetFv,
    values.currentPortfolio,
    values.annualContribution,
    values.monthlyExpenses,
    inflation,
  ]);

  const { chartData, chartSeries } = useMemo(() => {
    if (!series) return { chartData: [] as Record<string, number>[], chartSeries: [] as { dataKey: string; label: string; color: string }[] };
    const finite = series.map((s) => s.years).filter((y) => Number.isFinite(y));
    const horizon = finite.length
      ? Math.min(50, Math.max(10, Math.ceil(Math.max(...finite))))
      : 30;
    const trajectories = series.map((s) => ({
      label: s.label,
      pts: balanceTrajectory(values.currentPortfolio, values.annualContribution, s.rate, horizon),
    }));
    const nominal = Array.from({ length: horizon + 1 }, (_, t) => {
      const point: Record<string, number> = { year: t, target: targetFv };
      for (const tr of trajectories) point[tr.label] = tr.pts[t].balance;
      return point;
    });
    const data =
      displayMode === 'REAL'
        ? toRealSeries(nominal, inflation, { valueKeys: series.map((s) => s.label), yearKey: 'year' })
        : nominal;
    // Dash patterns for WCAG 1.4.1: series distinguished by both colour AND
    // stroke pattern (solid / dashed / dotted for up to 3 scenario trajectories;
    // the Target reference line is always dotted).
    const DASH_PATTERNS = [undefined, '5 5', '2 2', '8 4'] as const;
    const seriesDefs = [
      ...series.map((s, i) => ({
        dataKey: s.label,
        label: s.label,
        color: CHART_PALETTE[i % CHART_PALETTE.length],
        strokeDasharray: DASH_PATTERNS[i % DASH_PATTERNS.length],
      })),
      { dataKey: 'target', label: 'Target', color: CHART_NEUTRAL, strokeDasharray: '2 2' as const },
    ];
    return { chartData: data, chartSeries: seriesDefs };
  }, [series, values.currentPortfolio, values.annualContribution, targetFv, displayMode, inflation]);

  // ── Editable inputs (shared with the empty-state render below) ─────────────
  const controls = (
    <>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <NumberField
          id="fi-portfolio"
          label="Current portfolio"
          value={values.currentPortfolio}
          onChange={(v) => setValue('currentPortfolio', v ?? 0)}
          suffix="$"
          step="1000"
          min={0}
        />
        <NumberField
          id="fi-contrib"
          label="Annual contribution"
          value={values.annualContribution}
          onChange={(v) => setValue('annualContribution', v ?? 0)}
          suffix="$/yr"
          step="500"
          min={0}
        />
        <NumberField
          id="fi-expenses"
          label="Monthly expenses"
          value={values.monthlyExpenses}
          onChange={(v) => setValue('monthlyExpenses', v ?? 0)}
          suffix="$/mo"
          step="100"
          min={0}
        />
        <NumberField
          id="fi-swr"
          label="Withdrawal rate"
          value={values.withdrawalRatePct}
          onChange={(v) => setValue('withdrawalRatePct', v ?? 0)}
          suffix="%"
          step="0.1"
          min={0}
        />
      </div>

      {isOverridden && (
        <button
          type="button"
          onClick={reset}
          className="text-sm text-primary hover:underline mb-3"
        >
          Reset to my data
        </button>
      )}
    </>
  );

  if (!series || !household) {
    return (
      <CalculatorCard
        cardId={cardId}
        onHide={onHide}
        title={<>Years to <TermTooltip term="FI">FI</TermTooltip></>}
        titleText="Years to FI"
        headline={<span data-testid="fi-headline">—</span>}
      >
        {household ? controls : null}
        <p className="text-sm text-muted-foreground">Add your inputs to see Years to FI.</p>
      </CalculatorCard>
    );
  }

  // Pick a "primary" scenario for the headline. Prefer one labelled "Moderate"
  // so the user always sees a stable reference; otherwise fall back to the
  // middle of the list.
  const moderate =
    series.find((s) => s.label === 'Moderate') ??
    series[Math.min(1, series.length - 1)] ??
    series[0];
  const yearsLabel =
    moderate && Number.isFinite(moderate.years)
      ? `${moderate.years.toFixed(1)} years`
      : '∞';

  return (
    <CalculatorCard
      cardId={cardId}
      onHide={onHide}
      title={<>Years to <TermTooltip term="FI">FI</TermTooltip></>}
      titleText="Years to FI"
      headline={<span data-testid="fi-headline">{yearsLabel}</span>}
    >
      {controls}
      <p className="text-sm text-muted-foreground mb-3">
        Target portfolio:{' '}
        <span className="tabular-nums">{formatCurrency(targetFv)}</span>{' '}
        (= 12 × {formatCurrency(values.monthlyExpenses ?? 0)} /{' '}
        <TermTooltip term="SWR">
          {formatPercent((values.withdrawalRatePct ?? 0) / 100)}
        </TermTooltip>
        )
      </p>
      <p className="text-xs text-muted-foreground mb-3">
        Years assume <strong>real</strong> (inflation-adjusted) returns — the
        target is in today's dollars, so each scenario's rate is discounted by
        inflation before solving.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-2">Scenario</th>
            <th className="py-2">Rate</th>
            <th className="py-2">Years to FI</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.label} className="border-t">
              <td className="py-2">{s.label}</td>
              <td className="py-2 tabular-nums">{formatPercent(s.rate)}</td>
              <td className="py-2 tabular-nums">
                {Number.isFinite(s.years) ? s.years.toFixed(1) : '∞'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {chartData.length > 1 && (
        <div className="mt-4">
          <div className="flex justify-end mb-2">
            <RealNominalToggle mode={displayMode} onChange={setDisplayMode} />
          </div>
          <LineChartCard
            title="Path to FI"
            data={chartData}
            xKey="year"
            series={chartSeries}
            yFormatter={formatCurrency}
          />
        </div>
      )}
    </CalculatorCard>
  );
}
