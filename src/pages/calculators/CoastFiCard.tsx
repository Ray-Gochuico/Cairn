import { useMemo } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { CalculatorCard } from './CalculatorCard';
import { coastFi } from '@/lib/coast-fi';
import { currentAge } from '@/lib/dates';
import { formatCurrency } from '@/lib/format';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { useCalculatorState } from '@/lib/calculator-state';
import { NumberField } from '@/components/calculators/NumberField';

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

  // ── Real-data defaults (memoized from the stores) ──────────────────────────
  const defaults = useMemo(() => {
    // Latest snapshot per account: ISO date strings sort lexicographically
    // the same as chronologically, so a string compare is sufficient.
    const latestPerAccount = new Map<number, { date: string; value: number }>();
    for (const s of snapshots) {
      const prev = latestPerAccount.get(s.accountId);
      if (!prev || s.snapshotDate > prev.date) {
        latestPerAccount.set(s.accountId, { date: s.snapshotDate, value: s.totalValue });
      }
    }
    const currentPortfolio = [...latestPerAccount.values()].reduce(
      (sum, x) => sum + x.value,
      0,
    );

    // Shortest years-until-retirement across persons (fallback 20).
    let yearsUntilRetirement = 20;
    if (persons.length > 0) {
      const yearsByPerson = persons.map(
        (p) => p.targetRetirementAge - currentAge(p.dateOfBirth),
      );
      yearsUntilRetirement = Math.min(...yearsByPerson);
    }

    const annualExpenses = (household?.monthlyExpenseBaseline ?? 0) * 12;
    const withdrawalRate = household?.withdrawalRate ?? 0.04;

    return { currentPortfolio, yearsUntilRetirement, annualExpenses, withdrawalRate };
  }, [household, persons, snapshots]);

  const { values, setValue, reset, isOverridden } = useCalculatorState(cardId ?? 'coast-fi', defaults);

  // ── Empty-state guard ──────────────────────────────────────────────────────
  // withdrawalRate<=0 stays editable (targetFv guard → 0 rows) rather than
  // routing to empty-state, so the user can correct it inline.
  const hasData =
    !!household &&
    persons.length > 0 &&
    (household.growthScenarios?.length ?? 0) > 0;

  if (!hasData) {
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

  // ── Derived calculations ───────────────────────────────────────────────────
  const targetFv =
    values.withdrawalRate > 0 ? values.annualExpenses / values.withdrawalRate : 0;

  const rows: ScenarioRow[] = (household?.growthScenarios ?? []).map((s) => ({
    label: s.label,
    rate: s.rate,
    coastNeededToday: coastFi({
      requiredAtRetirement: targetFv,
      annualRate: s.rate,
      yearsUntilRetirement: values.yearsUntilRetirement,
    }),
  }));

  // ── Headline ───────────────────────────────────────────────────────────────
  const moderate =
    rows.find((r) => r.label === 'Moderate') ??
    rows[Math.min(1, rows.length - 1)] ??
    rows[0];
  const headlinePct =
    moderate && moderate.coastNeededToday > 0
      ? (values.currentPortfolio / moderate.coastNeededToday) * 100
      : 0;
  const headlineLabel = `${headlinePct.toFixed(0)}% of CoastFI`;

  const atOrPastRetirement = values.yearsUntilRetirement <= 0;

  // Display the stored fraction (0.04) as a percent (4); rounding past 8 dp
  // avoids float-display artifacts from the ÷100 round-trip on edit.
  const displayWithdrawalRate =
    values.withdrawalRate !== null
      ? Math.round(values.withdrawalRate * 100 * 1e8) / 1e8
      : null;

  return (
    <CalculatorCard
      cardId={cardId}
      onHide={onHide}
      title={<TermTooltip term="COAST FI">CoastFI</TermTooltip>}
      titleText="CoastFI"
      headline={
        atOrPastRetirement ? (
          <span data-testid="coastfi-headline">—</span>
        ) : (
          <span data-testid="coastfi-headline">{headlineLabel}</span>
        )
      }
    >
      {/* ── Editable inputs ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <NumberField
          id="cf-years"
          label="Years to retirement"
          value={values.yearsUntilRetirement}
          onChange={(v) => setValue('yearsUntilRetirement', v ?? 0)}
          step="1"
          min={0}
        />
        <NumberField
          id="cf-expenses"
          label="Annual expenses"
          value={values.annualExpenses}
          onChange={(v) => setValue('annualExpenses', v ?? 0)}
          suffix="$/yr"
          step="1000"
          min={0}
        />
        <NumberField
          id="cf-rate"
          label="Withdrawal rate"
          value={displayWithdrawalRate}
          onChange={(v) => setValue('withdrawalRate', v !== null ? v / 100 : 0)}
          suffix="%"
          step="0.1"
          min={0}
        />
        <NumberField
          id="cf-portfolio"
          label="Current portfolio"
          value={values.currentPortfolio}
          onChange={(v) => setValue('currentPortfolio', v ?? 0)}
          suffix="$"
          step="1000"
          min={0}
        />
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

      {/* ── At/past retirement guard ─────────────────────────────────────── */}
      {atOrPastRetirement ? (
        <p className="text-sm text-muted-foreground">
          Already at/after your target retirement age — no CoastFI horizon to
          compute.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mb-3">
            Target at retirement:{' '}
            <span className="tabular-nums">{formatCurrency(targetFv)}</span> in{' '}
            <span className="tabular-nums">{values.yearsUntilRetirement}</span>{' '}
            {values.yearsUntilRetirement === 1 ? 'year' : 'years'}
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
                  r.coastNeededToday > 0
                    ? (values.currentPortfolio / r.coastNeededToday) * 100
                    : 0;
                return (
                  <tr key={r.label} className="border-t">
                    <td className="py-2">{r.label}</td>
                    <td className="py-2 tabular-nums">{(r.rate * 100).toFixed(1)}%</td>
                    <td className="py-2 tabular-nums">{values.yearsUntilRetirement}</td>
                    <td className="py-2 tabular-nums">
                      {formatCurrency(r.coastNeededToday)}
                    </td>
                    <td className="py-2 tabular-nums">{pct.toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </CalculatorCard>
  );
}
