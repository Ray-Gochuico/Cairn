import { useCallback, useMemo, useState } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { pickModerateEntry } from '@/lib/growth-scenario';
import { CalculatorCard, EmptyMeaning, RailReset, RailViewGroup } from './CalculatorCard';
import { financialIndependenceSeries } from '@/lib/financial-independence';
import { coastFi } from '@/lib/coast-fi';
import { realRateOf, realRateOfUnfloored } from '@/lib/calculators/real-rate';
import { currentAge } from '@/lib/dates';
import { formatCurrency, formatPercent, formatSignedCurrency } from '@/lib/format';
import { useCalculatorState } from '@/lib/calculator-state';
import { NumberField } from '@/components/calculators/NumberField';
import { CalcTable, CalcRow, type CalcColumn } from '@/components/calculators/CalcTable';
import { InlineChart } from '@/components/charts/InlineChart';
import { buildProjectionChartData } from '@/lib/calculators/projection-chart';
import { RealNominalToggle } from '@/components/calculators/RealNominalToggle';
import { useChartDisplayMode } from '@/lib/calculators/use-chart-display-mode';
import { fiChartSeries } from '@/lib/calculators/fi-chart-series';
import { useScenarioAssumptions } from '@/lib/calculators/use-scenario-assumptions';
import { InlineLink } from '@/components/calculators/InlineLink';
import { cn } from '@/lib/utils';

type PathMode = 'KEEP' | 'STOP'; // "Keep contributing" | "Stop today"

// D13: fresh path-to-fi keys — the old financial-independence / coast-fi
// session keys held fields Wave 16 moved to the bar; carrying them forward
// would resurrect stale overrides of fields the rail no longer owns.
const MODE_KEY = 'calc-mode:path-to-fi';

function readMode(): PathMode {
  try {
    return sessionStorage.getItem(MODE_KEY) === 'STOP' ? 'STOP' : 'KEEP';
  } catch {
    return 'KEEP';
  }
}

/** Mode persistence — the useSupplementalMethod idiom (a view/question switch
 *  never sets isOverridden). */
function usePathMode(): [PathMode, (m: PathMode) => void] {
  const [mode, setMode] = useState<PathMode>(readMode);
  const set = useCallback((m: PathMode) => {
    setMode(m);
    try {
      sessionStorage.setItem(MODE_KEY, m);
    } catch {
      // sessionStorage unavailable — in-memory state still drives the UI.
    }
  }, []);
  return [mode, set];
}

const SEG_BTN_BASE = 'px-2 py-0.5 text-xs transition-colors';
const SEG_BTN_ACTIVE = 'bg-primary text-primary-foreground';

const COLUMNS: CalcColumn[] = [
  { key: 'scenario', header: 'Scenario' },
  { key: 'rate', header: 'Rate', numeric: true },
  { key: 'years', header: 'Years', numeric: true },
  { key: 'gap', header: 'Gap to coast', numeric: true },
];

interface PathToFiCardProps {
  cardId?: string;
}

/**
 * Wave 18 B8 — the merged Path to FI card (Years-to-FI + CoastFI). One
 * question, two modes: "Keep contributing" (years to the FI target) and
 * "Stop today" (% of the coast amount). Both solves keep the landed H1
 * real-rate discipline: years solve on the UNFLOORED Fisher real rate,
 * coast discounts by the FLOORED real rate (the CoastFI edge semantics).
 * All shared assumptions ride the Wave-16 scenario bar; only years-to-
 * retirement and the mode are rail-local (D13).
 */
export function PathToFiCard({ cardId }: PathToFiCardProps = {}) {
  const { household } = useHouseholdStore();
  const persons = usePersonsStore((s) => s.persons);
  const [mode, setMode] = usePathMode();

  // Local rail default: shortest years-until-retirement across persons
  // (fallback 20) — the CoastFiCard derivation, verbatim.
  const defaults = useMemo(() => {
    let yearsUntilRetirement = 20;
    if (persons.length > 0) {
      const yearsByPerson = persons.map(
        (p) => p.targetRetirementAge - currentAge(p.dateOfBirth),
      );
      yearsUntilRetirement = Math.min(...yearsByPerson);
    }
    return { yearsUntilRetirement };
  }, [persons]);
  const { values, setValue, reset, isOverridden, overriddenKeys } = useCalculatorState(
    cardId ?? 'path-to-fi',
    defaults,
  );
  const yearsUntilRetirement = values.yearsUntilRetirement ?? 0;

  const { engine, scenarioList, editedCount } = useScenarioAssumptions();
  const scenarioEdited = editedCount > 0;

  const [displayMode, setDisplayMode] = useChartDisplayMode(cardId ?? 'path-to-fi');
  const inflation = engine.inflation;

  const targetFv = engine.swr > 0 ? engine.annualExpenses / engine.swr : 0;
  const noTarget = targetFv <= 0 || engine.monthlyExpenses <= 0;
  const hasData = !!household && persons.length > 0 && scenarioList.length > 0;
  const atOrPastRetirement = yearsUntilRetirement <= 0;

  // FI solve — BOTH contribution bases: the mode-following series drives the
  // table/chart; the always-contributing series feeds the STOP meaning's
  // "yrs if you keep contributing" reading (the plan's dual-reading waymark —
  // a zero-contribution solve cannot honestly carry that label).
  const keepFiSeries = useMemo(() => {
    if (!hasData || noTarget) return null;
    return financialIndependenceSeries({
      pv: engine.portfolio,
      annualContribution: engine.annualContribution,
      targetFv,
      scenarios: scenarioList,
      inflation,
    });
  }, [hasData, noTarget, engine.portfolio, engine.annualContribution, targetFv, scenarioList, inflation]);
  const stopFiSeries = useMemo(() => {
    if (!hasData || noTarget) return null;
    return financialIndependenceSeries({
      pv: engine.portfolio,
      annualContribution: 0,
      targetFv,
      scenarios: scenarioList,
      inflation,
    });
  }, [hasData, noTarget, engine.portfolio, targetFv, scenarioList, inflation]);
  const fiSeries = mode === 'KEEP' ? keepFiSeries : stopFiSeries;

  // Coast solve (per scenario, floored real rate — the CoastFI edge semantics).
  const coastRows = useMemo(() => {
    if (!hasData || noTarget) return null;
    return scenarioList.map((s) => ({
      label: s.label,
      rate: s.rate,
      realRate: realRateOfUnfloored(s.rate, inflation),
      coastNeededToday: coastFi({
        requiredAtRetirement: targetFv,
        annualRate: realRateOf(s.rate, inflation),
        yearsUntilRetirement,
      }),
    }));
  }, [hasData, noTarget, scenarioList, inflation, targetFv, yearsUntilRetirement]);

  const moderateKeepFi = keepFiSeries ? pickModerateEntry(keepFiSeries) : undefined;
  const moderateFi = fiSeries ? pickModerateEntry(fiSeries) : undefined;
  const moderateCoast = coastRows
    ? (coastRows.find((r) => r.label === 'Moderate') ??
      coastRows[Math.min(1, coastRows.length - 1)])
    : undefined;
  const coastPct =
    moderateCoast && moderateCoast.coastNeededToday > 0 && !atOrPastRetirement
      ? (engine.portfolio / moderateCoast.coastNeededToday) * 100
      : 0;

  const anyUnreachable = (fiSeries ?? []).some((s) => !Number.isFinite(s.years));
  const coastFloored = scenarioList.some(
    (s) => realRateOfUnfloored(s.rate, inflation) < 0,
  );

  // Mode-following trajectory chart (ONE InlineChart; fiChartSeries owns
  // emphasis — hero is deliberately NOT set).
  const { chartData, chartSeries, chartMarkers } = useMemo(() => {
    const empty = {
      chartData: [] as Record<string, number>[],
      chartSeries: [] as ReturnType<typeof fiChartSeries>['series'],
      chartMarkers: [] as ReturnType<typeof fiChartSeries>['markers'],
    };
    if (!hasData || noTarget || !fiSeries) return empty;
    let horizon: number;
    if (mode === 'KEEP') {
      const finite = fiSeries.map((s) => s.years).filter((y) => Number.isFinite(y));
      horizon = finite.length ? Math.min(50, Math.max(10, Math.ceil(Math.max(...finite)))) : 30;
    } else {
      horizon = Math.max(0, Math.round(yearsUntilRetirement));
      if (horizon < 1) return empty;
    }
    const data = buildProjectionChartData({
      pv: engine.portfolio,
      annualContribution: mode === 'KEEP' ? engine.annualContribution : 0,
      targetFv,
      scenarios: fiSeries,
      inflation,
      displayMode,
      horizon,
    });
    const targetBasis = data.length > 0 ? Number(data[data.length - 1].target) : targetFv;
    const { series, markers } = fiChartSeries(
      fiSeries,
      data,
      targetBasis,
      mode === 'STOP' ? { targetLabel: 'Required at retirement' } : undefined,
    );
    return { chartData: data, chartSeries: series, chartMarkers: markers };
  }, [
    hasData,
    noTarget,
    fiSeries,
    mode,
    yearsUntilRetirement,
    engine.portfolio,
    engine.annualContribution,
    targetFv,
    inflation,
    displayMode,
  ]);

  const rail = (
    <>
      {isOverridden && <RailReset onClick={reset} />}
      <NumberField
        id="ptf-years"
        label="Years to retirement"
        value={values.yearsUntilRetirement}
        onChange={(v) => setValue('yearsUntilRetirement', v ?? 0)}
        step="1"
        min={0}
        edited={overriddenKeys.has('yearsUntilRetirement')}
      />
      <div
        role="group"
        aria-label="Path mode"
        className="inline-flex self-start rounded border overflow-hidden"
      >
        <button
          type="button"
          aria-pressed={mode === 'KEEP'}
          onClick={() => setMode('KEEP')}
          className={cn(SEG_BTN_BASE, mode === 'KEEP' ? SEG_BTN_ACTIVE : '')}
        >
          Keep contributing
        </button>
        <button
          type="button"
          aria-pressed={mode === 'STOP'}
          onClick={() => setMode('STOP')}
          className={cn(SEG_BTN_BASE, 'border-l', mode === 'STOP' ? SEG_BTN_ACTIVE : '')}
        >
          Stop today
        </button>
      </div>
      <RailViewGroup>
        <RealNominalToggle mode={displayMode} onChange={setDisplayMode} />
      </RailViewGroup>
    </>
  );

  if (!hasData) {
    return (
      <CalculatorCard
        cardId={cardId}
        title="Path to FI"
        headline={<span data-testid="path-to-fi-headline">—</span>}
        meaning={
          <EmptyMeaning>
            {!household ? (
              <>
                <InlineLink to="/inputs/household">Set up your household</InlineLink> to see
                your path to FI.
              </>
            ) : persons.length === 0 ? (
              <>
                <InlineLink to="/inputs/persons">Add a person</InlineLink> to see your path
                to FI.
              </>
            ) : (
              <>
                Your household has no growth scenarios —{' '}
                <InlineLink to="/inputs/household">
                  add growth scenarios in Household settings
                </InlineLink>{' '}
                to see your path to FI.
              </>
            )}
          </EmptyMeaning>
        }
      />
    );
  }

  if (noTarget || !fiSeries || !coastRows) {
    return (
      <CalculatorCard
        cardId={cardId}
        title="Path to FI"
        dirty={isOverridden || scenarioEdited}
        rail={rail}
        headline={<span data-testid="path-to-fi-headline">—</span>}
        meaning={
          <>
            Enter monthly expenses and a withdrawal rate in the scenario bar above to see
            your path to FI.
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Adjust shared assumptions in the scenario bar above.
        </p>
      </CalculatorCard>
    );
  }

  // ── Headline + meaning (dual-reading waymark) ──────────────────────────────
  const finiteYears = fiSeries.map((s) => s.years).filter((y) => Number.isFinite(y));
  const keepHeadline =
    moderateFi && Number.isFinite(moderateFi.years)
      ? `${moderateFi.years.toFixed(1)} years`
      : '—';
  const headline =
    mode === 'STOP' && atOrPastRetirement ? (
      <span data-testid="path-to-fi-headline">—</span>
    ) : mode === 'KEEP' ? (
      <span data-testid="path-to-fi-headline">
        {keepHeadline}
        {finiteYears.length > 1 && Number.isFinite(moderateFi?.years ?? Infinity) && (
          <span className="block text-xs font-normal text-muted-foreground">
            {Math.min(...finiteYears).toFixed(0)}–{Math.max(...finiteYears).toFixed(0)} years
            across scenarios
          </span>
        )}
      </span>
    ) : (
      <span data-testid="path-to-fi-headline">{`${coastPct.toFixed(0)}% of CoastFI`}</span>
    );

  const keepYearsLabel =
    moderateKeepFi && Number.isFinite(moderateKeepFi.years)
      ? moderateKeepFi.years.toFixed(1)
      : '—';
  const meaning =
    mode === 'KEEP' && (!moderateFi || !Number.isFinite(moderateFi.years)) ? (
      // Wave 17 honesty lock (verbatim): the warning REPLACES the sentence.
      <span className="text-warning-foreground">
        Returns at or below inflation — the target is never reached in real terms.
      </span>
    ) : mode === 'STOP' && atOrPastRetirement ? (
      <>Already at/after your target retirement age — no CoastFI horizon to compute.</>
    ) : mode === 'KEEP' ? (
      <>
        to your FI target · {coastPct.toFixed(0)}% of the way to coasting
      </>
    ) : (
      <>
        of the coast amount · {moderateKeepFi?.label ?? 'Moderate'} {keepYearsLabel} yrs if
        you keep contributing
      </>
    );

  return (
    <CalculatorCard
      cardId={cardId}
      title="Path to FI"
      dirty={isOverridden || scenarioEdited}
      meaning={meaning}
      rail={rail}
      headline={headline}
    >
      {mode === 'STOP' && atOrPastRetirement ? null : (
        <>
          {/* Teaching block — replaces the old duplicated real-basis footnotes. */}
          <p className="text-sm text-muted-foreground">
            Target {formatCurrency(targetFv)} = 12 × {formatCurrency(engine.monthlyExpenses)}
            /mo ÷ {formatPercent(engine.swr)} SWR — in today&#39;s dollars.
          </p>
          <p className="text-xs text-muted-foreground">
            You&#39;re {coastPct.toFixed(0)}% of the way to coasting — at 100% you could stop
            contributing now and still retire on time.
          </p>
          <CalcTable columns={COLUMNS} testId="path-to-fi-table">
            {fiSeries.map((s, i) => {
              const coast = coastRows[i];
              return (
                <CalcRow
                  key={s.label}
                  columns={COLUMNS}
                  cells={[
                    s.label,
                    <>
                      {formatPercent(s.rate)} ≈ {formatPercent(coast?.realRate ?? 0)} real
                    </>,
                    Number.isFinite(s.years) ? s.years.toFixed(1) : '—',
                    coast && !atOrPastRetirement
                      ? formatSignedCurrency(coast.coastNeededToday - engine.portfolio)
                      : '—',
                  ]}
                />
              );
            })}
          </CalcTable>
          {anyUnreachable && (
            <p role="note" className="text-xs text-muted-foreground">
              Returns at or below inflation — this scenario never reaches the target in real
              terms.
            </p>
          )}
          {coastFloored && (
            <p role="note" className="text-xs text-muted-foreground">
              A scenario&#39;s return is at or below inflation — its real rate is floored at
              0, so its coast target equals the full FI number.
            </p>
          )}
          {chartData.length > 1 && (
            <InlineChart
              label="Path to FI"
              testId="path-to-fi-chart"
              data={chartData as Array<Record<string, number | string>>}
              xKey="year"
              series={chartSeries}
              markers={chartMarkers}
              yFormatter={formatCurrency}
            />
          )}
        </>
      )}
    </CalculatorCard>
  );
}
