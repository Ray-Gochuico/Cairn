import { useMemo } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { CalculatorCard, EmptyMeaning, RailReset, RailViewGroup } from './CalculatorCard';
import { coastFi } from '@/lib/coast-fi';
import { realRateOf, realRateOfUnfloored } from '@/lib/calculators/real-rate';
import { currentAge } from '@/lib/dates';
import { formatCurrency, formatPercent } from '@/lib/format';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { useCalculatorState } from '@/lib/calculator-state';
import { NumberField } from '@/components/calculators/NumberField';
import LineChartCard from '@/components/charts/LineChartCard';
import { buildProjectionChartData } from '@/lib/calculators/projection-chart';
import { RealNominalToggle } from '@/components/calculators/RealNominalToggle';
import { useChartDisplayMode } from '@/lib/calculators/use-chart-display-mode';
import { fiChartSeries } from '@/lib/calculators/fi-chart-series';
import { useScenarioAssumptions } from '@/lib/calculators/use-scenario-assumptions';
import { InlineLink } from '@/components/calculators/InlineLink';

interface CoastFiCardProps {
  cardId?: string;
}

interface ScenarioRow {
  label: string;
  rate: number;
  coastNeededToday: number;
}

/**
 * Wave 16 (Basecamp spine): portfolio / expenses / SWR / return scenarios /
 * inflation now come from the shared scenario bar via useScenarioAssumptions
 * (engine units through the ONE pct/fraction boundary — the old in-card
 * annual-expenses and 0.04-vs-4 SWR representations, and their ×100/÷100
 * display gymnastics, are dead; D1/D3). Only `yearsUntilRetirement` stays
 * per-card (persons-derived, genuinely local), so the card's silo + reset
 * now truthfully cover that one field (D13).
 */
export function CoastFiCard({ cardId }: CoastFiCardProps = {}) {
  const { household } = useHouseholdStore();
  const persons = usePersonsStore((s) => s.persons);

  // ── Local (per-card) defaults — years only (D13) ───────────────────────────
  const defaults = useMemo(() => {
    // Shortest years-until-retirement across persons (fallback 20).
    let yearsUntilRetirement = 20;
    if (persons.length > 0) {
      const yearsByPerson = persons.map(
        (p) => p.targetRetirementAge - currentAge(p.dateOfBirth),
      );
      yearsUntilRetirement = Math.min(...yearsByPerson);
    }
    return { yearsUntilRetirement };
  }, [persons]);

  const { values, setValue, reset, isOverridden, overriddenKeys } = useCalculatorState(cardId ?? 'coast-fi', defaults);

  // ── Shared scenario (W16) ──────────────────────────────────────────────────
  const { engine, scenarioList, editedCount } = useScenarioAssumptions();
  // D6: the card's numbers differ from Inputs data when EITHER the local
  // years field or any shared ScenarioBar field is edited.
  const scenarioEdited = editedCount > 0;

  // ── Chart display mode (hooks MUST be before the early return) ─────────────
  const [displayMode, setDisplayMode] = useChartDisplayMode(cardId ?? 'coast-fi');
  // Wave 16: inflation rides the shared scenario (default = the same canonical
  // chain via buildScenarioDefaults; an edited bar value wins), so the table +
  // deflated chart + What-If agree for an un-edited bar exactly as before.
  const inflation = engine.inflation;

  // ── Empty-state guard ──────────────────────────────────────────────────────
  // withdrawalRate<=0 stays editable in the bar (targetFv guard → 0 rows)
  // rather than routing to empty-state, so the user can correct it in place.
  // D3: scenarioList is household.growthScenarios, or a single Custom row when
  // the bar's Return is edited.
  const hasData = !!household && persons.length > 0 && scenarioList.length > 0;

  // ── Derived calculations ───────────────────────────────────────────────────
  // Engine units only — annualExpenses (= monthly × 12) and the SWR fraction
  // both come from toEngineAssumptions (D1).
  const targetFv = engine.swr > 0 ? engine.annualExpenses / engine.swr : 0;
  // Wave 15 T4 (D11): a zero/negative target (expenses or SWR zeroed) is a
  // 0-of-$0 non-result — render an inline prompt with the years control still
  // mounted, never "0% of CoastFI".
  const noTarget = targetFv <= 0;

  // Rules of Hooks: this memo MUST run unconditionally, so it sits ABOVE the
  // empty-state return below — pre-fix it ran after that return, and a live
  // hasData flip (scenarios restored while /calculators was open) threw
  // "Rendered more hooks than during the previous render" and crashed the page.
  const { chartData, chartSeries, chartMarkers } = useMemo(() => {
    const horizon = Math.max(0, Math.round(values.yearsUntilRetirement));
    if (!hasData || horizon < 1 || scenarioList.length === 0 || targetFv <= 0) {
      return {
        chartData: [] as Record<string, number>[],
        chartSeries: [] as ReturnType<typeof fiChartSeries>['series'],
        chartMarkers: [] as ReturnType<typeof fiChartSeries>['markers'],
      };
    }
    // Single source for the rows (target-line basis lives in the builder —
    // see src/lib/calculators/projection-chart.ts). Coast = no contributions.
    const data = buildProjectionChartData({
      pv: engine.portfolio,
      annualContribution: 0,
      targetFv,
      scenarios: scenarioList,
      inflation,
      displayMode,
      horizon,
    });
    // Wave 15 T4: shared FI series semantics (Wave 11 T13) — Optimistic never
    // wears the palette red, Moderate emphasized, target-crossing markers.
    // The target-line basis in `data` follows the display toggle, so crossings
    // compare against the row's own target value.
    const targetBasis = data.length > 0 ? Number(data[data.length - 1].target) : targetFv;
    const { series, markers } = fiChartSeries(scenarioList, data, targetBasis, {
      targetLabel: 'Required at retirement',
    });
    return { chartData: data, chartSeries: series, chartMarkers: markers };
  }, [
    hasData,
    values.yearsUntilRetirement,
    engine.portfolio,
    targetFv,
    scenarioList,
    displayMode,
    inflation,
  ]);

  if (!hasData) {
    return (
      <CalculatorCard
        cardId={cardId}
        title={<TermTooltip term="COAST FI">CoastFI</TermTooltip>}
        titleText="CoastFI"
        headline="—"
        meaning={
          // Wave 15 T4: name the missing ingredient per cause with a real
          // link (copy verbatim; Wave 17 moves it into the meaning slot).
          <EmptyMeaning>
            {!household ? (
              <>
                <InlineLink to="/inputs/household">
                  Set up your household
                </InlineLink>{' '}
                to see CoastFI.
              </>
            ) : persons.length === 0 ? (
              <>
                <InlineLink to="/inputs/persons">
                  Add a person
                </InlineLink>{' '}
                to see CoastFI (retirement age sets the coasting horizon).
              </>
            ) : (
              <>
                Your household has no growth scenarios —{' '}
                <InlineLink to="/inputs/household">
                  add growth scenarios in Household settings
                </InlineLink>{' '}
                to see CoastFI.
              </>
            )}
          </EmptyMeaning>
        }
      />
    );
  }

  // H1: targetFv (= annualExpenses_today / SWR) is in today's dollars (real),
  // but scenario rates are NOMINAL. Discounting a real target by a nominal
  // rate UNDER-states the coast amount needed today. Convert each rate to REAL
  // (Fisher) before the PV solve, using the SAME inflation the chart's Real
  // toggle uses. The displayed `rate` stays nominal (what the user configured)
  // and the chart keeps using s.rate.
  const rows: ScenarioRow[] = scenarioList.map((s) => ({
    label: s.label,
    rate: s.rate,
    coastNeededToday: coastFi({
      requiredAtRetirement: targetFv,
      annualRate: realRateOf(s.rate, inflation),
      yearsUntilRetirement: values.yearsUntilRetirement,
    }),
  }));

  // T17: Coast-FI deliberately keeps the FLOORED real rate (a 0 real rate makes
  // "coast today" degenerate to the full FI target — the meaningful edge here,
  // unlike the FI years-to solve which uses the unfloored rate). Surface a note
  // when the floor actually bites for any scenario.
  const coastFloored = scenarioList.some(
    (s) => realRateOfUnfloored(s.rate, inflation) < 0,
  );

  // ── Headline ───────────────────────────────────────────────────────────────
  const moderate =
    rows.find((r) => r.label === 'Moderate') ??
    rows[Math.min(1, rows.length - 1)] ??
    rows[0];
  const headlinePct =
    moderate && moderate.coastNeededToday > 0
      ? (engine.portfolio / moderate.coastNeededToday) * 100
      : 0;
  const headlineLabel = `${headlinePct.toFixed(0)}% of CoastFI`;

  const atOrPastRetirement = values.yearsUntilRetirement <= 0;

  // Wave 17 meaning contract: warning/zero-target states REPLACE the sentence.
  const meaning = noTarget ? (
    // W16: the shared fields live in the scenario bar; no prefill promise
    // here — a typed 0 in the bar is an OVERRIDE that wins over recomputed
    // defaults (Wave 15 adversarial review, carried forward).
    <>Enter your monthly expenses and withdrawal rate in the scenario bar above to see your CoastFI target.</>
  ) : atOrPastRetirement ? (
    <>Already at/after your target retirement age — no CoastFI horizon to compute.</>
  ) : (
    <>
      {formatCurrency(engine.portfolio)} of the{' '}
      {formatCurrency(moderate?.coastNeededToday ?? 0)} needed today to coast.
    </>
  );

  return (
    <CalculatorCard
      cardId={cardId}
      title={<TermTooltip term="COAST FI">CoastFI</TermTooltip>}
      titleText="CoastFI"
      dirty={isOverridden || scenarioEdited}
      meaning={meaning}
      rail={
        <>
          {isOverridden && <RailReset onClick={reset} />}
          {/* ── Editable input — years only; the rest rides the bar (D13) ── */}
          <NumberField
            id="cf-years"
            label="Years to retirement"
            value={values.yearsUntilRetirement}
            onChange={(v) => setValue('yearsUntilRetirement', v ?? 0)}
            step="1"
            min={0}
            edited={overriddenKeys.has('yearsUntilRetirement')}
          />
          <RailViewGroup>
            <RealNominalToggle mode={displayMode} onChange={setDisplayMode} />
          </RailViewGroup>
        </>
      }
      headline={
        atOrPastRetirement || noTarget ? (
          <span data-testid="coastfi-headline">—</span>
        ) : (
          <span data-testid="coastfi-headline">{headlineLabel}</span>
        )
      }
    >
      {/* ── Zero-target (D11) + at/past retirement guards: the meaning slot
          carries the sentence; the body simply omits table/chart. ──── */}
      {!noTarget && !atOrPastRetirement && (
        <>
          <p className="text-sm text-muted-foreground mb-3">
            Target at retirement:{' '}
            <span className="tabular-nums">{formatCurrency(targetFv)}</span> in{' '}
            <span className="tabular-nums">{values.yearsUntilRetirement}</span>{' '}
            {values.yearsUntilRetirement === 1 ? 'year' : 'years'}
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            Coast amounts assume <strong>real</strong> (inflation-adjusted)
            returns — the target is in today's dollars, so each scenario's rate
            is discounted by inflation before solving. The chart matches: the
            Nominal view grows the target line with inflation; the Real view
            holds it flat in today's dollars.
          </p>
          {coastFloored && (
            <p role="note" className="text-xs text-muted-foreground mb-3">
              A scenario's return is at or below inflation — its real rate is
              floored at 0, so its coast target equals the full FI number.
            </p>
          )}
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Scenario</th>
                <th className="py-2 text-right">Rate</th>
                <th className="py-2 text-right">Years</th>
                <th className="py-2 text-right">Coast today</th>
                <th className="py-2 text-right">% of coast</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct =
                  r.coastNeededToday > 0
                    ? (engine.portfolio / r.coastNeededToday) * 100
                    : 0;
                return (
                  <tr key={r.label} className="border-t">
                    <td className="py-2">{r.label}</td>
                    <td className="py-2 text-right tabular-nums">{formatPercent(r.rate)}</td>
                    <td className="py-2 text-right tabular-nums">{values.yearsUntilRetirement}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCurrency(r.coastNeededToday)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{pct.toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {chartData.length > 1 && (
            <div className="mt-4">
              <LineChartCard
                title="Coasting to retirement"
                data={chartData}
                xKey="year"
                series={chartSeries}
                markers={chartMarkers}
                yFormatter={formatCurrency}
              />
            </div>
          )}
        </>
      )}
    </CalculatorCard>
  );
}
