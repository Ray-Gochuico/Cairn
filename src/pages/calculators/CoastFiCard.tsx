import { useMemo } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { CalculatorCard } from './CalculatorCard';
import { coastFi } from '@/lib/coast-fi';
import { currentAge } from '@/lib/dates';
import { formatCurrency } from '@/lib/format';
import { TermTooltip } from '@/components/ui/glossary-tooltip';

interface CoastFiCardProps {
  cardId?: string;
  onHide?: (cardId: string) => void;
}

interface ScenarioRow {
  label: string;
  rate: number;
  coastNeededToday: number;
}

export function CoastFiCard({ cardId, onHide }: CoastFiCardProps = {}) {
  const { household } = useHouseholdStore();
  const { persons } = usePersonsStore();
  const { snapshots } = useSnapshotsStore();

  const computed = useMemo(() => {
    if (!household || persons.length === 0) return null;
    if (!household.growthScenarios || household.growthScenarios.length === 0) return null;
    if (household.withdrawalRate <= 0) return null;

    // Latest snapshot per account: same approach as FinancialIndependenceCard. ISO date strings
    // sort lexicographically the same as chronologically, so a string compare
    // is sufficient.
    const latestPerAccount = new Map<number, { date: string; value: number }>();
    for (const s of snapshots) {
      const prev = latestPerAccount.get(s.accountId);
      if (!prev || s.snapshotDate > prev.date) {
        latestPerAccount.set(s.accountId, { date: s.snapshotDate, value: s.totalValue });
      }
    }
    const pv = [...latestPerAccount.values()].reduce((sum, x) => sum + x.value, 0);

    // Household coast horizon: pick the SHORTEST years-until-retirement across
    // persons. "Most conservative" = least time to grow, so the most $$ needed
    // today. (The plan said "older person's target age" — but if persons have
    // different target ages the min-years-to-go reading is unambiguous and
    // produces the right conservative answer in every case.)
    const yearsByPerson = persons.map(
      (p) => p.targetRetirementAge - currentAge(p.dateOfBirth),
    );
    const yearsUntilRetirement = Math.min(...yearsByPerson);

    // Same target as FinancialIndependenceCard: annual_expenses / withdrawal_rate.
    const targetFv = (household.monthlyExpenseBaseline * 12) / household.withdrawalRate;

    const rows: ScenarioRow[] = household.growthScenarios.map((s) => ({
      label: s.label,
      rate: s.rate,
      coastNeededToday: coastFi({
        requiredAtRetirement: targetFv,
        annualRate: s.rate,
        yearsUntilRetirement,
      }),
    }));

    return { pv, targetFv, yearsUntilRetirement, rows };
  }, [household, persons, snapshots]);

  if (!computed || !household) {
    return (
      <CalculatorCard
        cardId={cardId}
        onHide={onHide}
        title={<TermTooltip term="COAST FI">CoastFI</TermTooltip>}
        titleText="CoastFI"
        headline="—"
      >
        <p className="text-sm text-muted-foreground">Add your inputs to see CoastFI.</p>
      </CalculatorCard>
    );
  }

  const { pv, targetFv, yearsUntilRetirement, rows } = computed;

  // Headline percent uses the Moderate scenario when present; otherwise the
  // middle of the list (mirrors FinancialIndependenceCard's "stable reference" choice).
  const moderate =
    rows.find((r) => r.label === 'Moderate') ??
    rows[Math.min(1, rows.length - 1)] ??
    rows[0];
  const headlinePct =
    moderate && moderate.coastNeededToday > 0
      ? (pv / moderate.coastNeededToday) * 100
      : 0;
  const headlineLabel = `${headlinePct.toFixed(0)}% of CoastFI`;

  return (
    <CalculatorCard
      cardId={cardId}
      onHide={onHide}
      title={<TermTooltip term="COAST FI">CoastFI</TermTooltip>}
      titleText="CoastFI"
      headline={<span data-testid="coastfi-headline">{headlineLabel}</span>}
    >
      <p className="text-sm text-muted-foreground mb-3">
        Target at retirement:{' '}
        <span className="tabular-nums">{formatCurrency(targetFv)}</span> in{' '}
        <span className="tabular-nums">{yearsUntilRetirement}</span>{' '}
        {yearsUntilRetirement === 1 ? 'year' : 'years'}
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-2">Scenario</th>
            <th className="py-2">Rate</th>
            <th className="py-2">Years</th>
            <th className="py-2">Coast today</th>
            <th className="py-2">% of coast</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct =
              r.coastNeededToday > 0 ? (pv / r.coastNeededToday) * 100 : 0;
            return (
              <tr key={r.label} className="border-t">
                <td className="py-2">{r.label}</td>
                <td className="py-2 tabular-nums">{(r.rate * 100).toFixed(1)}%</td>
                <td className="py-2 tabular-nums">{yearsUntilRetirement}</td>
                <td className="py-2 tabular-nums">
                  {formatCurrency(r.coastNeededToday)}
                </td>
                <td className="py-2 tabular-nums">{pct.toFixed(0)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </CalculatorCard>
  );
}
