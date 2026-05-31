import { useMemo } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { CalculatorCard } from './CalculatorCard';
import { financialIndependenceSeries } from '@/lib/financial-independence';
import { formatCurrency } from '@/lib/format';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { useCalculatorState } from '@/lib/calculator-state';
import { NumberField } from '@/components/calculators/NumberField';
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

  // ── Real-data defaults (memoized from the stores) ──────────────────────────
  const defaults = useMemo(() => {
    // Latest snapshot per account on or before today — the canonical helper
    // (shared with What-If/Backtest). It applies the snapshotDate <= today
    // cutoff the old hand-rolled loop omitted.
    const todayIso = new Date().toISOString().slice(0, 10);
    const currentPortfolio = sumLatestOnOrBefore(snapshots, todayIso) ?? 0;

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
    // Stored as a 0–100 percent and divided by 100 in the computation.
    const withdrawalRatePct = effectiveSwr(null, household) * 100;

    return {
      currentPortfolio,
      annualContribution,
      monthlyExpenses: household?.monthlyExpenseBaseline ?? 0,
      withdrawalRatePct,
    };
  }, [household, snapshots, contributions]);

  const { values, setValue, reset, isOverridden } = useCalculatorState(
    cardId ?? 'financial-independence',
    defaults,
  );

  // ── Derived calculations (off the EDITED assumptions) ──────────────────────
  const targetFv = useMemo(() => {
    const swr = (values.withdrawalRatePct ?? 0) / 100;
    if (swr <= 0) return 0;
    return ((values.monthlyExpenses ?? 0) * 12) / swr;
  }, [values.monthlyExpenses, values.withdrawalRatePct]);

  const series = useMemo(() => {
    if (!household || persons.length === 0) return null;
    if (!household.growthScenarios || household.growthScenarios.length === 0)
      return null;
    // FI needs a positive target to compute (positive expenses + a positive
    // withdrawal rate). The SWR is editable, so a non-positive rate keeps the
    // card mounted (no rows) rather than empty-stating it.
    if ((values.monthlyExpenses ?? 0) <= 0) return null;
    if (targetFv <= 0) return null;

    return financialIndependenceSeries({
      pv: values.currentPortfolio,
      annualContribution: values.annualContribution,
      targetFv,
      scenarios: household.growthScenarios,
    });
  }, [
    household,
    persons,
    targetFv,
    values.currentPortfolio,
    values.annualContribution,
    values.monthlyExpenses,
  ]);

  // ── Editable inputs (shared with the empty-state render below) ─────────────
  const controls = (
    <>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <NumberField
          id="fi-portfolio"
          label="Current portfolio"
          value={values.currentPortfolio}
          onChange={(v) => setValue('currentPortfolio', v ?? 0)}
          suffix="$"
          step="1000"
          min={0}
        />
        <NumberField
          id="fi-contrib"
          label="Annual contribution"
          value={values.annualContribution}
          onChange={(v) => setValue('annualContribution', v ?? 0)}
          suffix="$/yr"
          step="500"
          min={0}
        />
        <NumberField
          id="fi-expenses"
          label="Monthly expenses"
          value={values.monthlyExpenses}
          onChange={(v) => setValue('monthlyExpenses', v ?? 0)}
          suffix="$/mo"
          step="100"
          min={0}
        />
        <NumberField
          id="fi-swr"
          label="Withdrawal rate"
          value={values.withdrawalRatePct}
          onChange={(v) => setValue('withdrawalRatePct', v ?? 0)}
          suffix="%"
          step="0.1"
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
    </>
  );

  if (!series || !household) {
    return (
      <CalculatorCard
        cardId={cardId}
        onHide={onHide}
        title={<>Years to <TermTooltip term="FI">FI</TermTooltip></>}
        titleText="Years to FI"
        headline={<span data-testid="fi-headline">—</span>}
      >
        {household ? controls : null}
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

  return (
    <CalculatorCard
      cardId={cardId}
      onHide={onHide}
      title={<>Years to <TermTooltip term="FI">FI</TermTooltip></>}
      titleText="Years to FI"
      headline={<span data-testid="fi-headline">{yearsLabel}</span>}
    >
      {controls}
      <p className="text-sm text-muted-foreground mb-3">
        Target portfolio:{' '}
        <span className="tabular-nums">{formatCurrency(targetFv)}</span>{' '}
        (= 12 × ${(values.monthlyExpenses ?? 0).toLocaleString()} /{' '}
        <TermTooltip term="SWR">
          {(values.withdrawalRatePct ?? 0).toFixed(1)}%
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
