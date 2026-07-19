import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { pickModerateEntry } from '@/lib/growth-scenario';
import { CalculatorCard, EmptyMeaning, RailViewGroup } from './CalculatorCard';
import { financialIndependenceSeries } from '@/lib/financial-independence';
import { formatCurrency, formatPercent } from '@/lib/format';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import LineChartCard from '@/components/charts/LineChartCard';
import { buildProjectionChartData } from '@/lib/calculators/projection-chart';
import { RealNominalToggle } from '@/components/calculators/RealNominalToggle';
import { useChartDisplayMode } from '@/lib/calculators/use-chart-display-mode';
import { fiChartSeries } from '@/lib/calculators/fi-chart-series';
import { useScenarioAssumptions } from '@/lib/calculators/use-scenario-assumptions';

interface FinancialIndependenceCardProps {
  cardId?: string;
}

/**
 * Wave 16 (Basecamp spine): every shared assumption — portfolio,
 * contribution, expenses, return scenarios, SWR, inflation — now comes from
 * the shared scenario bar via useScenarioAssumptions (engine units through
 * the ONE pct/fraction boundary; D1/D3). The card's four duplicated
 * NumberFields and its per-card silo `calc-state:financial-independence` are
 * retired (existing edits migrate one-shot in scenario-assumptions.ts, D7);
 * no editable state remains in-card, so the per-card reset is gone too (D13).
 */
export function FinancialIndependenceCard({
  cardId,
}: FinancialIndependenceCardProps = {}) {
  const { household } = useHouseholdStore();
  const persons = usePersonsStore((s) => s.persons);

  const { engine, scenarioList, editedCount } = useScenarioAssumptions();
  // D6: no local overrides remain in-card (W16 D13) — the dirty tick rides
  // solely on shared ScenarioBar edits.
  const scenarioEdited = editedCount > 0;

  // ── Chart display mode (Nominal/Real toggle) + inflation ───────────────────
  const [displayMode, setDisplayMode] = useChartDisplayMode(cardId ?? 'financial-independence');
  // Wave 16: inflation now rides the shared scenario (default = the same
  // canonical chain — household.inflationAssumption → settings.defaultInflation
  // → 0.03 — via buildScenarioDefaults; an edited bar value wins). N1/N3
  // agreement with What-If holds for an un-edited bar.
  const inflation = engine.inflation;

  // ── Derived calculations (off the SHARED scenario assumptions) ─────────────
  // targetFv = annualExpenses / SWR, both already in engine units (the ÷100
  // and ×12 conversions live in toEngineAssumptions — D1).
  const targetFv = engine.swr > 0 ? engine.annualExpenses / engine.swr : 0;

  const series = useMemo(() => {
    if (!household || persons.length === 0) return null;
    // D3: scenarioList is the household list, or a single Custom row when the
    // bar's Return is edited — the table can never disagree with the bar.
    if (scenarioList.length === 0) return null;
    // FI needs a positive target to compute (positive expenses + a positive
    // withdrawal rate). The SWR is editable, so a non-positive rate keeps the
    // card mounted (no rows) rather than empty-stating it.
    if (engine.monthlyExpenses <= 0) return null;
    if (targetFv <= 0) return null;

    // H1: targetFv is in today's dollars (real), but growthScenarios rates are
    // NOMINAL. Pass `inflation` so the years-to-FI solve converts each rate to
    // REAL first — otherwise a nominal balance reaches a real target too early
    // (optimistic). The result still carries the nominal rate for display/chart.
    return financialIndependenceSeries({
      pv: engine.portfolio,
      annualContribution: engine.annualContribution,
      targetFv,
      scenarios: scenarioList,
      inflation,
    });
  }, [
    household,
    persons,
    targetFv,
    engine.portfolio,
    engine.annualContribution,
    engine.monthlyExpenses,
    scenarioList,
    inflation,
  ]);

  const { chartData, chartSeries, chartMarkers } = useMemo(() => {
    if (!series)
      return {
        chartData: [] as Record<string, number>[],
        chartSeries: [] as ReturnType<typeof fiChartSeries>['series'],
        chartMarkers: [] as ReturnType<typeof fiChartSeries>['markers'],
      };
    const finite = series.map((s) => s.years).filter((y) => Number.isFinite(y));
    const horizon = finite.length
      ? Math.min(50, Math.max(10, Math.ceil(Math.max(...finite))))
      : 30;
    // Single source for the rows (target-line basis lives in the builder —
    // see src/lib/calculators/projection-chart.ts).
    const data = buildProjectionChartData({
      pv: engine.portfolio,
      annualContribution: engine.annualContribution,
      targetFv,
      scenarios: series,
      inflation,
      displayMode,
      horizon,
    });
    // Wave 11 T13: scenario colours (no danger-red Optimistic), emphasized
    // headline (Moderate) series, and target-crossing markers — via the shared
    // fi-chart-series helper. The target-line basis in `data` follows the
    // display toggle, so compare crossings against the row's own target value.
    const targetBasis = data.length > 0 ? Number(data[data.length - 1].target) : targetFv;
    const { series: seriesDefs, markers } = fiChartSeries(series, data, targetBasis);
    return { chartData: data, chartSeries: seriesDefs, chartMarkers: markers };
  }, [series, engine.portfolio, engine.annualContribution, targetFv, displayMode, inflation]);

  if (!series || !household) {
    return (
      <CalculatorCard
        cardId={cardId}
        title={<>Years to <TermTooltip term="FI">FI</TermTooltip></>}
        titleText="Years to FI"
        headline={<span data-testid="fi-headline">—</span>}
        meaning={
          // Wave 15 T4: name the missing ingredient per cause with a real
          // link (copy verbatim; Wave 17 moves it into the meaning slot).
          <EmptyMeaning>
            {!household ? (
              <>
                <Link to="/inputs/household" className="text-primary hover:underline">
                  Set up your household
                </Link>{' '}
                to see Years to FI.
              </>
            ) : persons.length === 0 ? (
              <>
                <Link to="/inputs/persons" className="text-primary hover:underline">
                  Add a person
                </Link>{' '}
                to see Years to FI.
              </>
            ) : scenarioList.length === 0 ? (
              <>
                Your household has no growth scenarios —{' '}
                <Link to="/inputs/household" className="text-primary hover:underline">
                  add growth scenarios in Household settings
                </Link>{' '}
                to see Years to FI.
              </>
            ) : (
              <>Enter monthly expenses and a withdrawal rate above to see Years to FI.</>
            )}
          </EmptyMeaning>
        }
      >
        {/* W16: the shared inputs live in the scenario bar above the grid. */}
        {household ? (
          <p className="text-sm text-muted-foreground mb-3">
            Adjust shared assumptions in the scenario bar above.
          </p>
        ) : null}
      </CalculatorCard>
    );
  }

  // Pick a "primary" scenario for the headline. Prefer one labelled "Moderate"
  // so the user always sees a stable reference; otherwise fall back to the
  // middle of the list.
  // Round-3 E7: same Moderate-selection rule as every other surface.
  const moderate = pickModerateEntry(series);
  // T17: a non-finite years value means the scenario's REAL rate is ≤ 0, so it
  // never reaches the today's-dollars target — render "—", not "∞", and surface
  // the explanatory note below the table.
  const yearsLabel =
    moderate && Number.isFinite(moderate.years)
      ? `${moderate.years.toFixed(1)} years`
      : '—';
  const anyUnreachable = series.some((s) => !Number.isFinite(s.years));

  // Wave 17 meaning contract: a non-finite headline scenario REPLACES the
  // sentence with the warning (a degraded headline never keeps a cheerful
  // caption). Review fix 3: the label comes from the SAME entry the headline
  // uses — an edited bar Return collapses the list to a single Custom row
  // (and some households have no 'Moderate' label at all), so hardcoding
  // "Moderate" would claim a scenario the card doesn't render.
  const meaning = !moderate || !Number.isFinite(moderate.years) ? (
    <span className="text-warning-foreground">
      Returns at or below inflation — the target is never reached in real terms.
    </span>
  ) : (
    <>{moderate.label} scenario to a {formatCurrency(targetFv)} target portfolio.</>
  );

  return (
    <CalculatorCard
      cardId={cardId}
      title={<>Years to <TermTooltip term="FI">FI</TermTooltip></>}
      titleText="Years to FI"
      dirty={scenarioEdited}
      meaning={meaning}
      rail={
        <RailViewGroup>
          <RealNominalToggle mode={displayMode} onChange={setDisplayMode} />
        </RailViewGroup>
      }
      headline={<span data-testid="fi-headline">{yearsLabel}</span>}
    >
      <p className="text-sm text-muted-foreground mb-3">
        Target portfolio:{' '}
        <span className="tabular-nums">{formatCurrency(targetFv)}</span>{' '}
        (= 12 × {formatCurrency(engine.monthlyExpenses)} /{' '}
        <TermTooltip term="SWR">
          {formatPercent(engine.swr)}
        </TermTooltip>
        )
      </p>
      <p className="text-xs text-muted-foreground mb-3">
        Years assume <strong>real</strong> (inflation-adjusted) returns — the
        target is in today's dollars, so each scenario's rate is discounted by
        inflation before solving. The chart matches: the Nominal view grows the
        target line with inflation; the Real view holds it flat in today's
        dollars.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-2">Scenario</th>
            <th className="py-2 text-right">Rate</th>
            <th className="py-2 text-right">Years to FI</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.label} className="border-t">
              <td className="py-2">{s.label}</td>
              <td className="py-2 text-right tabular-nums">{formatPercent(s.rate)}</td>
              <td className="py-2 text-right tabular-nums">
                {Number.isFinite(s.years) ? s.years.toFixed(1) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {anyUnreachable && (
        <p role="note" className="text-xs text-muted-foreground mt-2">
          Returns at or below inflation — this scenario never reaches the target
          in real terms.
        </p>
      )}
      {chartData.length > 1 && (
        <div className="mt-4">
          <LineChartCard
            title="Path to FI"
            data={chartData}
            xKey="year"
            series={chartSeries}
            markers={chartMarkers}
            yFormatter={formatCurrency}
          />
        </div>
      )}
    </CalculatorCard>
  );
}
