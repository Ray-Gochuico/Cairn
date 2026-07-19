import { useMemo } from 'react';
import { CalculatorCard } from './CalculatorCard';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import LineChartCard from '@/components/charts/LineChartCard';
import {
  compoundInterestSeries,
  apyToApr,
  toRealSummary,
  PERIODS_PER_YEAR,
  type CompoundFrequency,
} from '@/lib/compound-interest';
import { formatCurrency } from '@/lib/format';
import { useCalculatorState } from '@/lib/calculator-state';
import { NumberField } from '@/components/calculators/NumberField';
import { CHART_PALETTE } from '@/components/charts/palette';
import { RealNominalToggle } from '@/components/calculators/RealNominalToggle';
import { StatTile } from '@/components/calculators/StatTile';
import { useChartDisplayMode } from '@/lib/calculators/use-chart-display-mode';
import { toRealSeries } from '@/lib/calculators/real-mode';
import { useScenarioAssumptions } from '@/lib/calculators/use-scenario-assumptions';

interface CompoundInterestCardProps {
  cardId?: string;
  onHide?: (cardId: string) => void;
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
export function CompoundInterestCard({ cardId, onHide }: CompoundInterestCardProps = {}) {
  const { values, setValue, reset, isOverridden } = useCalculatorState(
    cardId ?? 'compound-interest',
    LOCAL_DEFAULTS,
  );

  const { engine } = useScenarioAssumptions();

  const series = useMemo(() => {
    const pvNum = engine.portfolio;
    const pmtNum = engine.monthlyContribution;
    const yearsNum = Math.max(0, Math.floor(values.years ?? 0));
    const apyNum = engine.returnRate;
    // Local variance keeps its in-card ÷100 — a genuinely local card field,
    // outside the D1 shared-field rule.
    const apyVarianceNum = values.variancePercent == null ? undefined : (values.variancePercent ?? 0) / 100;
    if (yearsNum === 0) return null;
    // The user-facing rate is APY (effective annual yield), but
    // compoundInterestSeries() interprets its rate input as APR. Convert
    // at the boundary so the engine math stays APR-consistent across the app
    // while the input matches what users see on a savings/CD comparison.
    const ppy = PERIODS_PER_YEAR[values.frequency];
    const aprRate = apyToApr(apyNum, ppy);
    // Variance preserves symmetry around APY → APR by converting low/high
    // bands first then differencing back to a single APR-variance number.
    // Approximation is fine: variance is a what-if knob, not a SOX number.
    let aprVariance: number | undefined;
    if (apyVarianceNum != null && apyVarianceNum > 0) {
      const lowApr = apyToApr(Math.max(-0.99, apyNum - apyVarianceNum), ppy);
      const highApr = apyToApr(apyNum + apyVarianceNum, ppy);
      aprVariance = (highApr - lowApr) / 2;
    }
    return compoundInterestSeries({
      pv: pvNum,
      monthlyContribution: pmtNum,
      annualRate: aprRate,
      varianceRate: aprVariance,
      years: yearsNum,
      frequency: values.frequency,
    });
  }, [values, engine]);

  const [displayMode, setDisplayMode] = useChartDisplayMode(cardId ?? 'compound-interest');
  // Wave 16: inflation rides the shared scenario (default = the same canonical
  // chain — household.inflationAssumption → settings.defaultInflation → 0.03 —
  // via buildScenarioDefaults; an edited bar value wins).
  const inflation = engine.inflation;

  // Real mode deflates the WHOLE card (headline + all three tiles), not just
  // the chart — a real chart beside nominal tiles is the nominal-on-real bug
  // class this app has shipped before. toRealSummary uses the horizon deflator
  // for balances and a per-period sum for contributions.
  const summary = useMemo(() => {
    if (!series) return null;
    if (displayMode === 'NOMINAL') return series;
    return toRealSummary(
      {
        pv: engine.portfolio,
        monthlyContribution: engine.monthlyContribution,
        annualRate: 0, // unused by toRealSummary — final balances come from `series`
        years: Math.max(0, Math.floor(values.years ?? 0)),
        frequency: values.frequency,
      },
      series,
      inflation,
    );
  }, [series, displayMode, inflation, values, engine]);

  const realSuffix = displayMode === 'REAL' ? " (today's $)" : '';

  const chartData = useMemo(() => {
    if (!series) return [];
    return series.yearly.map((y) => ({
      year: `Year ${y.year}`,
      yearNum: y.year,
      mid: y.mid,
      low: y.low,
      high: y.high,
    }));
  }, [series]);

  const hasVariance = values.variancePercent != null && (values.variancePercent ?? 0) > 0;
  // Expected (mid) leads and is emphasized (2.5px, solid, blue); Low/High are
  // thinner dashed/dotted bands (red/green). WCAG 1.4.1 opt-in: dash patterns
  // in addition to colour.
  const chartSeries = hasVariance
    ? [
        { dataKey: 'mid',  label: 'Expected (mid)', color: CHART_PALETTE[0], strokeWidth: 2.5 }, // blue / solid / emphasized
        { dataKey: 'low',  label: 'Low',  color: CHART_PALETTE[2], strokeDasharray: '5 5', strokeWidth: 1.5 }, // red / dashed
        { dataKey: 'high', label: 'High', color: CHART_PALETTE[4], strokeDasharray: '2 2', strokeWidth: 1.5 }, // green / dotted
      ]
    : [{ dataKey: 'mid', label: 'Balance', color: CHART_PALETTE[0] }];

  const displayData = useMemo(() => {
    if (displayMode === 'NOMINAL') return chartData;
    const keys = hasVariance ? ['low', 'mid', 'high'] : ['mid'];
    return toRealSeries(chartData, inflation, { valueKeys: keys, yearKey: 'yearNum' });
  }, [chartData, displayMode, hasVariance, inflation]);

  return (
    <CalculatorCard
      cardId={cardId}
      onHide={onHide}
      title="Compound Interest"
      headline={
        <span data-testid="compound-headline">
          {summary ? formatCurrency(summary.finalMid) : '—'}
          {summary && displayMode === 'REAL' && (
            // Wave 15 T5: a collapsed card must never be basis-ambiguous — the
            // REAL marker rides IN the headline, not only on tiles/chart title.
            <span className="text-base font-medium"> in today's dollars</span>
          )}
        </span>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <NumberField
          id="ci-years"
          label="Length (years)"
          value={values.years}
          onChange={(v) => setValue('years', v ?? 0)}
          step="1"
          min={0}
        />
        <NumberField
          id="ci-variance"
          label="Variance ± (%)"
          value={values.variancePercent}
          onChange={(v) => setValue('variancePercent', v)}
          step="0.1"
          min={0}
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

      {series && summary ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 text-sm">
            <StatTile
              label={`Total contributed${realSuffix}`}
              value={formatCurrency(summary.totalContributed)}
              testId="compound-total-contributed"
            />
            <StatTile
              label={`Total interest (mid)${realSuffix}`}
              value={formatCurrency(summary.totalInterestMid)}
              testId="compound-total-interest"
            />
            <StatTile
              label={`Final balance (mid)${realSuffix}`}
              value={formatCurrency(summary.finalMid)}
            />
          </div>
          <div className="flex justify-end mb-2">
            <RealNominalToggle mode={displayMode} onChange={setDisplayMode} />
          </div>
          <LineChartCard
            title={`Balance over time${displayMode === 'REAL' ? " (today's dollars)" : ''}`}
            data={displayData}
            xKey="year"
            series={chartSeries}
            yFormatter={(v) => formatCurrency(v)}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Enter a length in years to see projected growth.</p>
      )}
    </CalculatorCard>
  );
}
