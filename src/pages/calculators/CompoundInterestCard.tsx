import { useMemo } from 'react';
import { CalculatorCard, EmptyMeaning, RailReset, RailViewGroup } from './CalculatorCard';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { InlineChart } from '@/components/charts/InlineChart';
import {
  compoundInterestSeries,
  apyToApr,
  PERIODS_PER_YEAR,
  type CompoundFrequency,
  type CompoundInterestInput,
} from '@/lib/compound-interest';
import { formatCurrency, formatPercent } from '@/lib/format';
import { useCalculatorState } from '@/lib/calculator-state';
import { NumberField } from '@/components/calculators/NumberField';
import { CHART_PALETTE } from '@/components/charts/palette';
import { StatTile } from '@/components/calculators/StatTile';
import { useScenarioAssumptions } from '@/lib/calculators/use-scenario-assumptions';
import { useCalcScope } from '@/lib/calculators/use-calc-scope';
import {
  buildHistoryFanView,
  useCompoundBasisView,
  HISTORY_FAN_KEYS,
  type RegisteredChart,
  type RegisteredFigure,
} from '@/lib/calculators/basis-view';
import { HISTORY_FAN_MIN_SEQUENCES, historyFan } from '@/lib/history-fan';
import { useGatedReturnSource } from '@/lib/calculators/use-chart-source';
import { ReturnSourceControl } from '@/components/calculators/ReturnSourceControl';
import { HistoryFanLegend } from '@/components/calculators/HistoryFanLegend';
import {
  COMPOUND_CADENCE_CAPTION,
  FAN_LEGEND_MEDIAN,
  HISTORY_CHART_LABEL_COMPOUND,
  fanCaption,
  noStretchLine,
  tooFewStretchesLine,
} from '@/lib/calculators/history-fan-copy';
import { DisclosureModal } from '@/legal/DisclosureModal';

interface CompoundInterestCardProps {
  cardId?: string;
}

const FREQUENCY_OPTIONS: Array<{ value: CompoundFrequency; label: string }> = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'ANNUALLY', label: 'Annually' },
];

// W16 (D13): only the genuinely-local what-if knobs stay in the card silo
// (calc-state:compound-interest). pv / monthly contribution / rate now ride
// the shared scenario (their legacy silo keys migrate one-shot in
// scenario-assumptions.ts).
// W2: the History median is an ORDER STATISTIC, not the plan's headline
// trajectory — foreground-stroked, deliberately never `hero`.
const MEDIAN_STROKE = 'hsl(var(--foreground))';
const HISTORY_SERIES_COMPOUND = [
  { dataKey: 'p50', label: FAN_LEGEND_MEDIAN, color: MEDIAN_STROKE, strokeWidth: 2.5 },
] as const;

const LOCAL_DEFAULTS = {
  years: 10,
  variancePercent: null as number | null,
  frequency: 'MONTHLY' as CompoundFrequency,
};

/**
 * Wave 16 (Basecamp spine): principal, contribution and rate come from the
 * shared scenario bar via useScenarioAssumptions — pv = the bar's portfolio,
 * PMT = annualContribution/12 (converted at the ONE boundary, D1), APY = the
 * scenario return read as an effective annual yield (D4; the card's own
 * APY→APR conversion below is untouched). The `pv > 0 ? pv : 1000` demo
 * fallback is dead (D4): an empty profile shows an honest $0-based projection
 * — the bar above says $0, and this card can no longer contradict it.
 */
export function CompoundInterestCard({ cardId }: CompoundInterestCardProps = {}) {
  const { values, setValue, reset, isOverridden, overriddenKeys } = useCalculatorState(
    cardId ?? 'compound-interest',
    LOCAL_DEFAULTS,
  );

  const { engine, editedCount } = useScenarioAssumptions();
  const scope = useCalcScope();
  // D6: local what-if knobs OR shared ScenarioBar edits raise the tick.
  const scenarioEdited = editedCount > 0;

  // Engine input built once; the SAME object feeds compoundInterestSeries AND
  // the basis boundary's real-summary conversion — the two can never diverge.
  const engineInput = useMemo<CompoundInterestInput | null>(() => {
    const yearsNum = Math.max(0, Math.floor(values.years ?? 0));
    if (yearsNum === 0) return null;
    const apyNum = engine.returnRate;
    // Local variance keeps its in-card ÷100 — a genuinely local card field,
    // outside the D1 shared-field rule.
    const apyVarianceNum =
      values.variancePercent == null ? undefined : (values.variancePercent ?? 0) / 100;
    // The user-facing rate is APY (effective annual yield), but
    // compoundInterestSeries() interprets its rate input as APR. Convert
    // at the boundary so the engine math stays APR-consistent across the app
    // while the input matches what users see on a savings/CD comparison.
    const ppy = PERIODS_PER_YEAR[values.frequency];
    const aprRate = apyToApr(apyNum, ppy);
    // Variance preserves symmetry around APY → APR by converting low/high
    // bands first then differencing back to a single APR-variance number.
    let aprVariance: number | undefined;
    if (apyVarianceNum != null && apyVarianceNum > 0) {
      const lowApr = apyToApr(Math.max(-0.99, apyNum - apyVarianceNum), ppy);
      const highApr = apyToApr(apyNum + apyVarianceNum, ppy);
      aprVariance = (highApr - lowApr) / 2;
    }
    return {
      pv: engine.portfolio,
      monthlyContribution: engine.monthlyContribution,
      annualRate: aprRate,
      varianceRate: aprVariance,
      years: yearsNum,
      frequency: values.frequency,
    };
  }, [values, engine]);

  const series = useMemo(
    () => (engineInput ? compoundInterestSeries(engineInput) : null),
    [engineInput],
  );

  // W5: the ONE conversion boundary — already-based, already-formatted values
  // + the matching basis phrase, in one bundle (D-T5). This card never sees a
  // raw projected number beside a basis flag it could ignore.
  const view = useCompoundBasisView(engineInput, series);

  // W2 (D-UB3/D-UB10): the per-card return source, demoted to Assumed while the
  // shared `backtest` disclosure is un-accepted (restart-safe).
  const { source, gateDocument, selectAssumed, requestHistory, acceptAndSwitch, cancelGate } =
    useGatedReturnSource(cardId ?? 'compound-interest');

  // W2: the History census. Compound has no target ⇒ no holds line (D-UB9),
  // and the recurrence compounds ANNUALLY at real historical returns — CH-4
  // says so, because the return-rate, frequency and variance knobs all govern
  // the assumed view only.
  const historyView = useMemo(() => {
    if (source !== 'HISTORY') return null;
    const H = Math.max(0, Math.floor(values.years ?? 0)); // the landed years rule
    if (H === 0) return null; // the landed years-0 empty case owns this state
    const result = historyFan({
      pv: engine.portfolio,
      annualContribution: 12 * engine.monthlyContribution,
      horizonYears: H,
    });
    return { result, view: buildHistoryFanView(result, { xLabel: 'year-word' }) };
  }, [source, values.years, engine.portfolio, engine.monthlyContribution]);

  const hasVariance = values.variancePercent != null && (values.variancePercent ?? 0) > 0;
  // Expected (mid) leads and is emphasized (2.5px, solid, blue); Low/High are
  // thinner dashed/dotted bands (red/green). WCAG 1.4.1 opt-in: dash patterns
  // in addition to colour. Wave-18 A4: with no variance the single balance
  // line IS the headline trajectory → blaze hero + cairn terminal; the
  // 3-series variance view keeps its palette peers (no hero among equals).
  const chartSeries = hasVariance
    ? [
        { dataKey: 'mid',  label: 'Expected (mid)', color: CHART_PALETTE[0], strokeWidth: 2.5 }, // blue / solid / emphasized
        { dataKey: 'low',  label: 'Low',  color: CHART_PALETTE[2], strokeDasharray: '5 5', strokeWidth: 1.5 }, // red / dashed
        { dataKey: 'high', label: 'High', color: CHART_PALETTE[4], strokeDasharray: '2 2', strokeWidth: 1.5 }, // green / dotted
      ]
    : [{ dataKey: 'mid', label: 'Balance', hero: true }];

  // Wave 17 meaning contract: values the card already renders (bar pv + APY
  // + the local years knob); the years-0 prompt REPLACES it (the empty case).
  const meaning = !series ? (
    <EmptyMeaning>Enter a length in years to see projected growth.</EmptyMeaning>
  ) : engine.portfolio <= 0 ? (
    // Wave C (N3): a bare "$0 at 6% APY for 10 years." reads like a verdict
    // on an empty profile — invite instead (CW21).
    <EmptyMeaning>Enter a starting portfolio in the scenario bar to see growth.</EmptyMeaning>
  ) : (
    // Wave B (CB14): person scope names the owner — the pv IS the scoped
    // bar portfolio, so the qualifier sources only rendered values.
    <>
      <span data-testid="compound-starting-provenance">{formatCurrency(engine.portfolio)}</span>
      {scope.isScoped ? ` in ${scope.personName}'s accounts` : ''} at{' '}
      {formatPercent(engine.returnRate)} APY for {Math.max(0, Math.floor(values.years ?? 0))} years.
    </>
  );

  return (
    <CalculatorCard
      cardId={cardId}
      title="Compound Interest"
      dirty={isOverridden || scenarioEdited}
      meaning={meaning}
      rail={
        <>
          {isOverridden && <RailReset onClick={reset} />}
          <NumberField
            id="ci-years"
            label="Length (years)"
            value={values.years}
            onChange={(v) => setValue('years', v ?? 0)}
            step="1"
            min={0}
            edited={overriddenKeys.has('years')}
          />
          <NumberField
            id="ci-variance"
            label="Variance ± (%)"
            value={values.variancePercent}
            onChange={(v) => setValue('variancePercent', v)}
            step="0.1"
            min={0}
            edited={overriddenKeys.has('variancePercent')}
          />
          <div className="space-y-1">
            <Label htmlFor="ci-frequency">Compound frequency</Label>
            <Select
              value={values.frequency}
              onValueChange={(v) => setValue('frequency', v as CompoundFrequency)}
            >
              <SelectTrigger id="ci-frequency" aria-label="Compound frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <RailViewGroup>
            <ReturnSourceControl
              source={source}
              onAssumed={selectAssumed}
              onHistory={requestHistory}
            />
          </RailViewGroup>
          {gateDocument != null && (
            <DisclosureModal
              document={gateDocument}
              onAccept={acceptAndSwitch}
              onCancel={cancelGate}
            />
          )}
        </>
      }
      headline={
        <span data-testid="compound-headline">
          {view ? view.fmt.headline : '—'}
          {view && (
            // Wave 15 T5, extended by W5 D-T4: a collapsed card must never be
            // basis-ambiguous — the basis phrase rides IN the headline, BOTH modes.
            <span className="text-base font-medium"> {view.phrase}</span>
          )}
        </span>
      }
    >
      {view && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 text-sm">
            <StatTile
              label={`Total contributed ${view.suffix}`}
              value={view.fmt.totalContributed}
              testId="compound-total-contributed"
            />
            <StatTile
              label={`Total interest (mid) ${view.suffix}`}
              value={view.fmt.totalInterest}
              testId="compound-total-interest"
            />
            <StatTile
              label={`Final balance (mid) ${view.suffix}`}
              value={view.fmt.finalBalance}
              testId="compound-final-balance"
            />
          </div>
          {source === 'HISTORY' && historyView != null ? (
            historyView.result.m === 0 ? (
              <p
                role="note"
                className="text-xs text-muted-foreground"
                data-testid="compound-history-degraded"
              >
                {noStretchLine({ H: historyView.result.horizonYears })}
              </p>
            ) : historyView.result.m < HISTORY_FAN_MIN_SEQUENCES ? (
              <p
                role="note"
                className="text-xs text-muted-foreground"
                data-testid="compound-history-degraded"
              >
                {tooFewStretchesLine({
                  M: historyView.result.m,
                  H: historyView.result.horizonYears,
                })}
              </p>
            ) : (
              <>
                <InlineChart
                  label={HISTORY_CHART_LABEL_COMPOUND}
                  labelTestId="compound-history-chart-caption"
                  testId="compound-history-chart"
                  data={historyView.view.chartData}
                  xKey="year"
                  series={[...HISTORY_SERIES_COMPOUND]}
                  fan={HISTORY_FAN_KEYS}
                  yFormatter={(v) => formatCurrency(v)}
                />
                <HistoryFanLegend series={HISTORY_SERIES_COMPOUND} />
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="compound-history-caption"
                >
                  {fanCaption({ M: historyView.result.m, H: historyView.result.horizonYears })}
                </p>
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="compound-history-cadence"
                >
                  {COMPOUND_CADENCE_CAPTION}
                </p>
              </>
            )
          ) : (
            <InlineChart
              label={view.chartLabel}
              labelTestId="compound-chart-caption"
              testId="compound-chart"
              data={view.chartData}
              xKey="year"
              series={chartSeries}
              yFormatter={(v) => formatCurrency(v)}
            />
          )}
        </>
      )}
    </CalculatorCard>
  );
}

/** W5 test-only registration — the basis-audit sweep enforces per-class
 *  discipline + $-completeness against this list (frozen contract for W2). */
export const COMPOUND_BASIS_FIGURES: RegisteredFigure[] = [
  { testId: 'compound-headline', cls: 'convertible' },          // inventory #1
  { testId: 'compound-total-contributed', cls: 'convertible' }, // #2
  { testId: 'compound-total-interest', cls: 'convertible' },    // #3
  { testId: 'compound-final-balance', cls: 'convertible' },     // #4
  { testId: 'compound-starting-provenance', cls: 'invariant' }, // #6 (year-0)
];
export const COMPOUND_BASIS_CHARTS: RegisteredChart[] = [
  { chartTestId: 'compound-chart', captionTestId: 'compound-chart-caption', cls: 'convertible' }, // #5
];

/** W2 test-only registration (D-UB13): the History view swaps the Assumed
 *  chart out, so it registers its OWN chart list — a PINNED today's-dollars
 *  figure, byte-identical in both page bases. Figures are unchanged. */
export const COMPOUND_HISTORY_BASIS_CHARTS: RegisteredChart[] = [
  {
    chartTestId: 'compound-history-chart',
    captionTestId: 'compound-history-chart-caption',
    cls: 'pinned',
    pinnedBasis: 'today',
  },
];
