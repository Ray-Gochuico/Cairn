import { useMemo, useState } from 'react';
import { CalculatorCard } from './CalculatorCard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LineChartCard from '@/components/charts/LineChartCard';
import {
  compoundInterestSeries,
  type CompoundFrequency,
} from '@/lib/compound-interest';
import { formatCurrency } from '@/lib/format';

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
  // Inputs are local component state — this card is interactive what-if, not persisted.
  const [pv, setPv] = useState<string>('1000');
  const [monthlyContribution, setMonthlyContribution] = useState<string>('100');
  const [years, setYears] = useState<string>('10');
  const [ratePercent, setRatePercent] = useState<string>('7');
  const [variancePercent, setVariancePercent] = useState<string>('');
  const [frequency, setFrequency] = useState<CompoundFrequency>('MONTHLY');

  const series = useMemo(() => {
    const pvNum = Number(pv) || 0;
    const pmtNum = Number(monthlyContribution) || 0;
    const yearsNum = Math.max(0, Math.floor(Number(years) || 0));
    const rateNum = (Number(ratePercent) || 0) / 100;
    const varNum = variancePercent === '' ? undefined : (Number(variancePercent) || 0) / 100;
    if (yearsNum === 0) return null;
    return compoundInterestSeries({
      pv: pvNum,
      monthlyContribution: pmtNum,
      annualRate: rateNum,
      varianceRate: varNum,
      years: yearsNum,
      frequency,
    });
  }, [pv, monthlyContribution, years, ratePercent, variancePercent, frequency]);

  const headline = series ? formatCurrency(series.finalMid) : '—';

  const chartData = useMemo(() => {
    if (!series) return [];
    return series.yearly.map((y) => ({
      year: `Year ${y.year}`,
      mid: y.mid,
      low: y.low,
      high: y.high,
    }));
  }, [series]);

  const hasVariance = variancePercent !== '' && Number(variancePercent) > 0;
  // Red = pessimistic (rate - variance), blue = expected (mid),
  // green = optimistic (rate + variance). Single-line view uses blue.
  const chartSeries = hasVariance
    ? [
        { dataKey: 'low', label: 'Low', color: '#dc2626' },
        { dataKey: 'mid', label: 'Mid', color: '#2563eb' },
        { dataKey: 'high', label: 'High', color: '#16a34a' },
      ]
    : [{ dataKey: 'mid', label: 'Balance', color: '#2563eb' }];

  return (
    <CalculatorCard
      cardId={cardId}
      onHide={onHide}
      title="Compound Interest"
      headline={<span data-testid="compound-headline">{headline}</span>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div>
          <Label htmlFor="ci-pv">Initial amount</Label>
          <Input id="ci-pv" type="number" step="any" value={pv} onChange={(e) => setPv(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ci-pmt">Monthly contribution</Label>
          <Input id="ci-pmt" type="number" step="any" value={monthlyContribution} onChange={(e) => setMonthlyContribution(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ci-years">Length (years)</Label>
          <Input id="ci-years" type="number" step="1" min="1" value={years} onChange={(e) => setYears(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ci-rate">Estimated rate (%)</Label>
          <Input id="ci-rate" type="number" step="0.1" value={ratePercent} onChange={(e) => setRatePercent(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ci-variance">Variance ± (%)</Label>
          <Input id="ci-variance" type="number" step="0.1" value={variancePercent} onChange={(e) => setVariancePercent(e.target.value)} placeholder="optional" />
        </div>
        <div>
          <Label htmlFor="ci-frequency">Compound frequency</Label>
          <select
            id="ci-frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as CompoundFrequency)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {FREQUENCY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {series ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 text-sm">
            <div className="rounded-md border bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground">Total contributed</div>
              <div className="text-base font-semibold tabular-nums" data-testid="compound-total-contributed">
                {formatCurrency(series.totalContributed)}
              </div>
            </div>
            <div className="rounded-md border bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground">Total interest (mid)</div>
              <div className="text-base font-semibold tabular-nums" data-testid="compound-total-interest">
                {formatCurrency(series.totalInterestMid)}
              </div>
            </div>
            <div className="rounded-md border bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground">Final balance (mid)</div>
              <div className="text-base font-semibold tabular-nums">
                {formatCurrency(series.finalMid)}
              </div>
            </div>
          </div>
          <LineChartCard
            title="Balance over time"
            data={chartData}
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
