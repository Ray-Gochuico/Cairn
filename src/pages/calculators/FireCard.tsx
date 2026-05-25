import { useMemo } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { CalculatorCard } from './CalculatorCard';
import { fireSeries } from '@/lib/fire';
import { formatCurrency } from '@/lib/format';

interface FireCardProps {
  cardId?: string;
  onHide?: (cardId: string) => void;
}

export function FireCard({ cardId, onHide }: FireCardProps = {}) {
  const { household } = useHouseholdStore();
  const { persons } = usePersonsStore();
  const { snapshots } = useSnapshotsStore();
  const { contributions } = useContributionsStore();

  const series = useMemo(() => {
    if (!household || persons.length === 0) return null;
    if (!household.growthScenarios || household.growthScenarios.length === 0) return null;
    if (household.withdrawalRate <= 0) return null;

    // Latest snapshot per account: walk snapshots once and keep max-by-date
    // per accountId. ISO date strings sort lexicographically the same as
    // chronologically, so a string compare is sufficient.
    const latestPerAccount = new Map<number, { date: string; value: number }>();
    for (const s of snapshots) {
      const prev = latestPerAccount.get(s.accountId);
      if (!prev || s.snapshotDate > prev.date) {
        latestPerAccount.set(s.accountId, { date: s.snapshotDate, value: s.totalValue });
      }
    }
    const pv = [...latestPerAccount.values()].reduce((sum, x) => sum + x.value, 0);

    // Rolling 12-month contribution total — used as the annual PMT figure for
    // the FV solver. We compare ISO date strings; chronological order matches
    // string order for YYYY-MM-DD.
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const isoYearAgo = oneYearAgo.toISOString().slice(0, 10);
    const annualContribution = contributions
      .filter((c) => c.date >= isoYearAgo)
      .reduce((sum, c) => sum + c.amount, 0);

    const targetFv = (household.monthlyExpenseBaseline * 12) / household.withdrawalRate;

    return fireSeries({
      pv,
      annualContribution,
      targetFv,
      scenarios: household.growthScenarios,
    });
  }, [household, persons, snapshots, contributions]);

  if (!series || !household) {
    return (
      <CalculatorCard cardId={cardId} onHide={onHide} title="Years to FI" headline="—">
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
  const targetFv = (household.monthlyExpenseBaseline * 12) / household.withdrawalRate;

  return (
    <CalculatorCard
      cardId={cardId}
      onHide={onHide}
      title="Years to FI"
      headline={<span data-testid="fire-headline">{yearsLabel}</span>}
    >
      <p className="text-sm text-muted-foreground mb-3">
        Target portfolio:{' '}
        <span className="tabular-nums">{formatCurrency(targetFv)}</span>{' '}
        (= 12 × ${household.monthlyExpenseBaseline.toLocaleString()} /{' '}
        {(household.withdrawalRate * 100).toFixed(1)}%)
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
              <td className="py-2 tabular-nums">{(s.rate * 100).toFixed(1)}%</td>
              <td className="py-2 tabular-nums">
                {Number.isFinite(s.years) ? s.years.toFixed(1) : '∞'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </CalculatorCard>
  );
}
