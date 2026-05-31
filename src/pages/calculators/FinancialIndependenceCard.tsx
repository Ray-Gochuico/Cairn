import { useMemo } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { CalculatorCard } from './CalculatorCard';
import { financialIndependenceSeries } from '@/lib/financial-independence';
import { formatCurrency } from '@/lib/format';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { sumLatestOnOrBefore } from '@/lib/growth-horizons';
import { effectiveSwr } from '@/lib/scenarios/effective-swr';

interface FinancialIndependenceCardProps {
  cardId?: string;
  onHide?: (cardId: string) => void;
}

export function FinancialIndependenceCard({
  cardId,
  onHide,
}: FinancialIndependenceCardProps = {}) {
  const { household } = useHouseholdStore();
  const { persons } = usePersonsStore();
  const { snapshots } = useSnapshotsStore();
  const { contributions } = useContributionsStore();

  const series = useMemo(() => {
    if (!household || persons.length === 0) return null;
    if (!household.growthScenarios || household.growthScenarios.length === 0) return null;
    // Guard on positive expenses — FI needs a target to compute; effectiveSwr
    // is always positive so guarding on the rate is obsolete (a withdrawalRate=0
    // household now uses the 0.04 canonical default via effectiveSwr).
    if ((household.monthlyExpenseBaseline ?? 0) <= 0) return null;

    // Latest snapshot per account on or before today — the canonical helper
    // (shared with What-If/Backtest). It applies the snapshotDate <= today
    // cutoff the old hand-rolled loop omitted.
    const todayIso = new Date().toISOString().slice(0, 10);
    const pv = sumLatestOnOrBefore(snapshots, todayIso) ?? 0;

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
    const withdrawalRate = effectiveSwr(null, household);
    const targetFv = (household.monthlyExpenseBaseline * 12) / withdrawalRate;

    return financialIndependenceSeries({
      pv,
      annualContribution,
      targetFv,
      scenarios: household.growthScenarios,
    });
  }, [household, persons, snapshots, contributions]);

  if (!series || !household) {
    return (
      <CalculatorCard
        cardId={cardId}
        onHide={onHide}
        title={<>Years to <TermTooltip term="FI">FI</TermTooltip></>}
        titleText="Years to FI"
        headline="—"
      >
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
  const withdrawalRate = effectiveSwr(null, household);
  const targetFv = (household.monthlyExpenseBaseline * 12) / withdrawalRate;

  return (
    <CalculatorCard
      cardId={cardId}
      onHide={onHide}
      title={<>Years to <TermTooltip term="FI">FI</TermTooltip></>}
      titleText="Years to FI"
      headline={<span data-testid="fi-headline">{yearsLabel}</span>}
    >
      <p className="text-sm text-muted-foreground mb-3">
        Target portfolio:{' '}
        <span className="tabular-nums">{formatCurrency(targetFv)}</span>{' '}
        (= 12 × ${household.monthlyExpenseBaseline.toLocaleString()} /{' '}
        <TermTooltip term="SWR">
          {(household.withdrawalRate * 100).toFixed(1)}%
        </TermTooltip>
        )
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
