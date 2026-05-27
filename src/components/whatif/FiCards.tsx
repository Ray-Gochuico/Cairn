import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { coastFi } from '@/lib/coast-fi';
import { currentAge } from '@/lib/dates';
import { formatCurrency } from '@/lib/format';
import { effectiveSwr } from '@/lib/scenarios/effective-swr';
import { totalInvestments } from '@/lib/scenarios/aggregate-investments';
import type { MonthlyState } from '@/lib/scenarios';
import { useScenariosStore } from '@/stores/scenarios-store';
import type { Household, Person } from '@/types/schema';
import type { Scenario } from '@/types/scenario';

export interface FiCardsProps {
  scenarios: Scenario[];
  projections: Map<number, MonthlyState[]>;
  household: Household;
  persons: Person[];
}

interface ComputedRow {
  liquidNw: number;
  fiTarget: number;
  coastFiTarget: number;
  yearsUntilRetirement: number;
  rate: number;
  rateLabel: string;
  swr: number;
}

function pickReferenceScenario(scenarios: Scenario[]): Scenario | null {
  const visible = scenarios.filter((s) => s.visible);
  return (
    visible.find((s) => s.isActive) ??
    visible.find((s) => s.isBaseline) ??
    visible[0] ??
    null
  );
}

function pickRate(household: Household): { rate: number; label: string } | null {
  const list = household.growthScenarios;
  if (!list || list.length === 0) return null;
  const moderate = list.find((s) => s.label.toLowerCase() === 'moderate');
  const pick = moderate ?? list[Math.min(1, list.length - 1)] ?? list[0];
  return { rate: pick.rate, label: pick.label };
}

function computeCards(props: FiCardsProps): ComputedRow | null {
  const { scenarios, projections, household, persons } = props;
  if (!household || persons.length === 0) return null;
  const rate = pickRate(household);
  if (!rate) return null;

  const ref = pickReferenceScenario(scenarios);
  if (!ref || ref.id == null) return null;
  const states = projections.get(ref.id);
  if (!states || states.length === 0) return null;
  const seed = states[0];

  const swr = effectiveSwr(ref, household);
  if (swr <= 0) return null;

  const liquidNw = totalInvestments(seed) + seed.cash;
  const fiTarget = (household.monthlyExpenseBaseline * 12) / swr;

  const yearsByPerson = persons.map(
    (p) => p.targetRetirementAge - currentAge(p.dateOfBirth),
  );
  const yearsUntilRetirement = Math.max(0, Math.min(...yearsByPerson));

  const coastFiTarget = coastFi({
    requiredAtRetirement: fiTarget,
    annualRate: rate.rate,
    yearsUntilRetirement,
  });

  return {
    liquidNw,
    fiTarget,
    coastFiTarget,
    yearsUntilRetirement,
    rate: rate.rate,
    rateLabel: rate.label,
    swr,
  };
}

interface FiCardProps {
  testId: string;
  title: ReactNode;
  target: number;
  liquidNw: number;
  explainer: ReactNode;
}

function FiCard({ testId, title, target, liquidNw, explainer }: FiCardProps) {
  const pct = target > 0 ? (liquidNw / target) * 100 : 0;
  return (
    <Card className="min-w-0 flex-1" data-testid={testId}>
      <CardContent className="py-4">
        <div className="text-sm text-muted-foreground">{title}</div>
        <div className="text-xl sm:text-2xl font-semibold tabular-nums break-words">
          {formatCurrency(target)}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{explainer}</div>
        <div className="mt-2 text-xs tabular-nums" data-testid={`${testId}-progress`}>
          {formatCurrency(liquidNw)} / {formatCurrency(target)} ·{' '}
          <span className="font-medium">{pct.toFixed(0)}%</span>
        </div>
      </CardContent>
    </Card>
  );
}

function defaultRetirementAge(persons: Person[]): number | null {
  const ages = persons
    .map((p) => p.targetRetirementAge)
    .filter((n): n is number => typeof n === 'number');
  if (ages.length === 0) return null;
  return Math.min(...ages);
}

function RetirementAgeControl({
  scenarios,
  persons,
}: {
  scenarios: Scenario[];
  persons: Person[];
}) {
  const active = scenarios.find((s) => s.isActive);
  if (!active?.id) return null;

  const override = active.leverPayload.retirementAgeOverride;
  const fallback = defaultRetirementAge(persons);
  const display = override ?? fallback ?? '';

  const handleChange = async (raw: string) => {
    if (raw === '') {
      await useScenariosStore.getState().updateLever(active.id!, { retirementAgeOverride: null });
      return;
    }
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(30, Math.min(90, n));
    await useScenariosStore.getState().updateLever(active.id!, { retirementAgeOverride: clamped });
  };

  return (
    <div className="flex items-center gap-2 text-sm" data-testid="whatif-retirement-age-control">
      <Label htmlFor="whatif-retirement-age" className="text-xs text-muted-foreground">
        Retire at age
      </Label>
      <Input
        id="whatif-retirement-age"
        type="number"
        min={30}
        max={90}
        step={1}
        value={display}
        onChange={(e) => handleChange(e.target.value)}
        aria-label="Retirement age"
        className="h-8 w-20 tabular-nums"
      />
      {override !== null && (
        <span className="text-xs text-muted-foreground">
          (override; person default {fallback ?? '—'})
        </span>
      )}
    </div>
  );
}

export default function FiCards(props: FiCardsProps) {
  const computed = computeCards(props);
  if (!computed) return null;

  const { liquidNw, fiTarget, coastFiTarget, yearsUntilRetirement, rate, rateLabel, swr } = computed;
  const ratePct = (rate * 100).toFixed(1);
  const withdrawalPct = (swr * 100).toFixed(1);

  return (
    <div className="space-y-2" data-testid="whatif-fi-cards-wrap">
      <div className="flex flex-col sm:flex-row gap-3" data-testid="whatif-fi-cards">
        <FiCard
          testId="whatif-fi-number"
          title={
            <>
              <TermTooltip term="FI">Financial Independence</TermTooltip> number
            </>
          }
          target={fiTarget}
          liquidNw={liquidNw}
          explainer={
            <>
              Portfolio at retirement (
              <TermTooltip term="SWR">{withdrawalPct}% rule</TermTooltip>
              )
            </>
          }
        />
        <FiCard
          testId="whatif-coastfi-number"
          title={
            <>
              <TermTooltip term="COAST FI">Coast FI</TermTooltip> target today
            </>
          }
          target={coastFiTarget}
          liquidNw={liquidNw}
          explainer={`${rateLabel} ${ratePct}% growth, ${yearsUntilRetirement}y to retirement`}
        />
      </div>
      <RetirementAgeControl scenarios={props.scenarios} persons={props.persons} />
    </div>
  );
}
