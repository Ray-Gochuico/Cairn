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
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { useCalculatorState } from '@/lib/calculator-state';
import { NumberField } from '@/components/calculators/NumberField';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { fiEligiblePortfolioValue } from '@/lib/fi-portfolio';
import { useSettingsStore } from '@/stores/settings-store';
import { useHouseholdStore } from '@/stores/household-store';
import { effectiveBaselineInflation } from '@/lib/scenarios/effective-inflation';
import { CHART_PALETTE } from '@/components/charts/palette';
import { RealNominalToggle } from '@/components/calculators/RealNominalToggle';
import { StatTile } from '@/components/calculators/StatTile';
import { useChartDisplayMode } from '@/lib/calculators/use-chart-display-mode';
import { toRealSeries } from '@/lib/calculators/real-mode';

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

export function CompoundInterestCard({ cardId, onHide }: CompoundInterestCardProps = {}) {
  const { snapshots } = useSnapshotsStore();
  const accounts = useAccountsStore((s) => s.accounts);
  // Kit-managed input state: persists in sessionStorage under calc-state:compound-interest.
  // pv is prefilled from the latest portfolio snapshot; falls back to 1000 demo default.
  const defaults = useMemo(() => {
    // Shared FI-eligible definition (src/lib/fi-portfolio.ts): non-excluded
    // accounts minus 529s, latest snapshot per account on-or-before today.
    // Pre-Wave-2 this summed EVERY account — a 529 inflated the retirement
    // default.
    const todayIso = new Date().toISOString().slice(0, 10);
    const currentPortfolio = fiEligiblePortfolioValue(accounts, snapshots, todayIso);
    return {
      pv: currentPortfolio > 0 ? currentPortfolio : 1000,   // portfolio prefill; 1000 demo fallback
      monthlyContribution: 100,
      years: 10,
      ratePercent: 7,
      variancePercent: null as number | null,
      frequency: 'MONTHLY' as CompoundFrequency,
    };
  }, [snapshots, accounts]);

  const { values, setValue, reset, isOverridden } = useCalculatorState(
    cardId ?? 'compound-interest',
    defaults,
  );

  const series = useMemo(() => {
    const pvNum = values.pv ?? 0;
    const pmtNum = values.monthlyContribution ?? 0;
    const yearsNum = Math.max(0, Math.floor(values.years ?? 0));
    const apyNum = (values.ratePercent ?? 0) / 100;
    const apyVarianceNum = values.variancePercent == null ? undefined : (values.variancePercent ?? 0) / 100;
    if (yearsNum === 0) return null;
    // The user-facing input is APY (effective annual yield), but
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
  }, [values]);

  const [displayMode, setDisplayMode] = useChartDisplayMode(cardId ?? 'compound-interest');
  // Wave 15 T5: the CANONICAL inflation chain (household.inflationAssumption →
  // settings.defaultInflation → 0.03) — the SAME resolver FI/CoastFI use. The
  // old `settings?.defaultInflation ?? 0.025` bypassed the household setting
  // and carried a divergent fallback.
  const { household } = useHouseholdStore();
  const settings = useSettingsStore((s) => s.settings);
  const inflation = effectiveBaselineInflation(null, household ?? null, settings);

  // Real mode deflates the WHOLE card (headline + all three tiles), not just
  // the chart — a real chart beside nominal tiles is the nominal-on-real bug
  // class this app has shipped before. toRealSummary uses the horizon deflator
  // for balances and a per-period sum for contributions.
  const summary = useMemo(() => {
    if (!series) return null;
    if (displayMode === 'NOMINAL') return series;
    return toRealSummary(
      {
        pv: values.pv ?? 0,
        monthlyContribution: values.monthlyContribution ?? 0,
        annualRate: 0, // unused by toRealSummary — final balances come from `series`
        years: Math.max(0, Math.floor(values.years ?? 0)),
        frequency: values.frequency,
      },
      series,
      inflation,
    );
  }, [series, displayMode, inflation, values]);

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
          id="ci-pv"
          label="Initial amount"
          value={values.pv}
          onChange={(v) => setValue('pv', v ?? 0)}
          step="any"
          min={0}
        />
        <NumberField
          id="ci-pmt"
          label="Monthly contribution"
          value={values.monthlyContribution}
          onChange={(v) => setValue('monthlyContribution', v ?? 0)}
          step="any"
          min={0}
        />
        <NumberField
          id="ci-years"
          label="Length (years)"
          value={values.years}
          onChange={(v) => setValue('years', v ?? 0)}
          step="1"
          min={0}
        />
        <NumberField
          id="ci-rate"
          label={<TermTooltip term="APY">APY (%)</TermTooltip>}
          ariaLabel="Annual percentage yield"
          value={values.ratePercent}
          onChange={(v) => setValue('ratePercent', v ?? 0)}
          step="0.1"
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
