import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { coastFi } from '@/lib/coast-fi';
import { realRateOf, realRateOfUnfloored } from '@/lib/calculators/real-rate';
import { currentAge } from '@/lib/dates';
import { formatCurrency } from '@/lib/format';
import { effectiveSwr } from '@/lib/scenarios/effective-swr';
import { effectiveBaselineInflation } from '@/lib/scenarios/effective-inflation';
import { totalInvestments } from '@/lib/scenarios/aggregate-investments';
import type { MonthlyState } from '@/lib/scenarios';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { AppSettings, Household, Person } from '@/types/schema';
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
  inflation: number;
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

/**
 * Sentinel return for `computeCards` when the household/persons setup
 * isn't done yet. Distinct from "transient null" (no projection state
 * available for the current scenario) — callers render an empty-state
 * stub with a setup CTA only for this branch.
 */
const SETUP_REQUIRED = 'setup-required' as const;
type ComputeResult = ComputedRow | null | typeof SETUP_REQUIRED;

function computeCards(props: FiCardsProps, settings: AppSettings | null): ComputeResult {
  const { scenarios, projections, household, persons } = props;
  // Cold-start: no household yet, or zero persons → caller renders the
  // setup-CTA empty state (W7-UX MF-8).
  if (!household || persons.length === 0) return SETUP_REQUIRED;
  const rate = pickRate(household);
  if (!rate) return null;

  const ref = pickReferenceScenario(scenarios);
  if (!ref || ref.id == null) return null;
  const states = projections.get(ref.id);
  if (!states || states.length === 0) return null;
  const seed = states[0];

  const swr = effectiveSwr(ref, household);
  if (swr <= 0) return null;

  // Seed-derived "liquid net worth": non-excluded accounts via the projection
  // seed (computeInitialBalances), so 529s are included here unlike the
  // dashboard FI defaults (src/lib/fi-portfolio.ts — the shared retirement-FI
  // definition excludes them). Kept as-is deliberately: the seed IS the
  // number the projection compounds, and re-deriving it here would let the
  // cards disagree with the chart they annotate.
  const liquidNw = totalInvestments(seed) + seed.cash;
  const fiTarget = (household.monthlyExpenseBaseline * 12) / swr;

  const yearsByPerson = persons.map(
    (p) => p.targetRetirementAge - currentAge(p.dateOfBirth),
  );
  const yearsUntilRetirement = Math.max(0, Math.min(...yearsByPerson));

  // Coast FI: discount the today's-$ FI target by the REAL growth rate.
  // Mixing a real target with a nominal rate is the bug fixed in W7-Finance.
  // N1: resolve inflation through the CANONICAL chain (the same
  // effectiveBaselineInflation the dashboard FI/Coast cards now use) so both
  // surfaces produce identical coast numbers for the same household, and the
  // shared realRateOf() applies the same 0-floor on the negative-real edge.
  const inflation = effectiveBaselineInflation(ref, household, settings);
  const realRate = realRateOf(rate.rate, inflation);
  const coastFiTarget = coastFi({
    requiredAtRetirement: fiTarget,
    annualRate: realRate,
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
    inflation,
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

  return (
    <RetirementAgeInput
      key={active.id}
      display={String(display)}
      onCommit={async (raw) => {
        if (raw === '') {
          await useScenariosStore.getState().updateLever(active.id!, { retirementAgeOverride: null });
          return;
        }
        const n = Math.round(Number(raw));
        if (!Number.isFinite(n)) return;
        const clamped = Math.max(30, Math.min(90, n));
        await useScenariosStore.getState().updateLever(active.id!, { retirementAgeOverride: clamped });
      }}
      override={override}
      fallback={fallback}
    />
  );
}

// W10 T11: commit the retirement age on BLUR / Enter, never per keystroke —
// typing "65" used to persist 30 (clamped '6'), then 36…, corrupting the value
// mid-type. A local draft mirrors the input; the clamp + updateLever fire once.
function RetirementAgeInput({
  display,
  onCommit,
  override,
  fallback,
}: {
  display: string;
  onCommit: (raw: string) => Promise<void>;
  override: number | null;
  fallback: number | null;
}) {
  const [draft, setDraft] = useState(display);
  useEffect(() => { setDraft(display); }, [display]);

  const commit = () => { void onCommit(draft.trim()); };

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
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
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

/**
 * Withdrawal-strategy selector (R2 wiring-sweep — Finance review NEW-3).
 *
 * Surfaces the LeverPayload.withdrawalStrategy field that's been engine-side
 * since b41227c. Two choices:
 *   - Proportional (default) — pull from every account in proportion to balance.
 *   - Sequential              — taxable → tax-deferred → Roth.
 *
 * No persistence shape change; relies on the existing scenario lever update path.
 */
function WithdrawalStrategyControl({
  scenarios,
}: {
  scenarios: Scenario[];
}) {
  const active = scenarios.find((s) => s.isActive);
  if (!active?.id) return null;

  const current =
    (active.leverPayload as { withdrawalStrategy?: 'proportional' | 'sequential' }).withdrawalStrategy
    ?? 'proportional';

  const handleChange = async (next: 'proportional' | 'sequential') => {
    await useScenariosStore
      .getState()
      .updateLever(active.id!, { withdrawalStrategy: next });
  };

  return (
    <div
      className="flex items-center gap-2 text-sm"
      data-testid="whatif-withdrawal-strategy-control"
    >
      <Label htmlFor="whatif-withdrawal-strategy" className="text-xs text-muted-foreground">
        Withdrawal order
      </Label>
      <select
        id="whatif-withdrawal-strategy"
        className="h-8 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm"
        value={current}
        onChange={(e) => void handleChange(e.target.value as 'proportional' | 'sequential')}
        aria-label="Withdrawal strategy"
      >
        <option value="proportional">Proportional (default)</option>
        <option value="sequential">Sequential (taxable → pre-tax → Roth)</option>
      </select>
      <TermTooltip term="sequential withdrawal">
        <span className="text-xs text-muted-foreground underline-offset-2">
          What&#39;s this?
        </span>
      </TermTooltip>
    </div>
  );
}

/**
 * Inline drawdown-tax-rate indicator (W7-UX MF-6).
 *
 * The `effectiveDrawdownTaxRate` setting lives only in Settings → Advanced,
 * which means What-If users who pick the SEQUENTIAL withdrawal strategy
 * have no inline cue that an assumption is in effect or what value is
 * being applied. Pre-fix the projection silently gross-ups Trad-401(k)
 * withdrawals by 0% (if Settings is unset) or by the user's saved
 * percentage — with no surfacing on the page that does the math.
 *
 * Renders only when strategy === 'sequential'. Shows the resolved
 * effective rate (`defaultDrawdownTaxRate` from Settings, or "Not set"
 * when null) alongside a deep-link to Settings → Advanced for one-click
 * adjustment. Wrapped in a TermTooltip so the abbreviation is reachable.
 */
function DrawdownTaxRateInline({
  scenarios,
}: {
  scenarios: Scenario[];
}) {
  const active = scenarios.find((s) => s.isActive);
  const strategy =
    (active?.leverPayload as { withdrawalStrategy?: 'proportional' | 'sequential' })
      ?.withdrawalStrategy ?? 'proportional';
  // Hook order constraint: useSettingsStore must be called unconditionally
  // (it's a Zustand hook). The strategy check gates the *render*, not the
  // hook call.
  const settings = useSettingsStore((s) => s.settings);

  if (strategy !== 'sequential') return null;

  const rate = settings?.defaultDrawdownTaxRate ?? null;
  const display =
    rate === null ? 'Not set' : `${(rate * 100).toFixed(0)}%`;

  return (
    <div
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      data-testid="whatif-drawdown-tax-rate-inline"
    >
      <TermTooltip term="DRAWDOWN TAX RATE">
        <span>Drawdown tax rate</span>
      </TermTooltip>
      <span>:</span>
      <span className="tabular-nums font-medium text-foreground">{display}</span>
      <span>·</span>
      <Link
        to="/settings"
        className="underline hover:text-foreground"
        data-testid="whatif-drawdown-tax-rate-settings-link"
      >
        Settings &rsaquo; Advanced
      </Link>
    </div>
  );
}

/**
 * Empty-state stub (W7-UX MF-8) shown when the user lands on the
 * What-If page before completing first-run setup — no household saved,
 * or zero persons in the household. Previously the FI cards silently
 * returned null in this case, leaving a confusing gap on the page;
 * the stub gives users a card-styled prompt with two deep-link CTAs.
 */
function FiCardsEmptyState() {
  return (
    <Card data-testid="whatif-fi-cards-empty">
      <CardContent className="py-6 text-center text-sm text-muted-foreground space-y-2">
        <p>
          Add a household and at least one person to see FI projections.
        </p>
        <div className="text-xs space-x-1">
          <Link
            to="/inputs/household"
            className="underline hover:text-foreground"
            data-testid="whatif-fi-cards-empty-household-link"
          >
            Set up household
          </Link>
          <span>·</span>
          <Link
            to="/inputs/persons"
            className="underline hover:text-foreground"
            data-testid="whatif-fi-cards-empty-persons-link"
          >
            Add persons
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default function FiCards(props: FiCardsProps) {
  // N1: feed the canonical inflation resolver the app settings so the Coast FI
  // figure matches the dashboard cards exactly (household.inflationAssumption
  // takes precedence; settings.defaultInflation is the fallback).
  const settings = useSettingsStore((s) => s.settings);
  const computed = computeCards(props, settings);
  if (computed === SETUP_REQUIRED) {
    return <FiCardsEmptyState />;
  }
  if (!computed) return null;

  const { liquidNw, fiTarget, coastFiTarget, yearsUntilRetirement, rate, rateLabel, swr, inflation } =
    computed;
  const ratePct = (rate * 100).toFixed(1);
  const withdrawalPct = (swr * 100).toFixed(1);
  // T17: state BOTH bases so the modal/chart real-dollar numbers are legible —
  // "Moderate 7.0% nominal (≈4.4% real after 2.5% inflation)".
  const realPct = (realRateOfUnfloored(rate, inflation) * 100).toFixed(1);
  const inflationPct = (inflation * 100).toFixed(1);

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
          explainer={`${rateLabel} ${ratePct}% nominal (≈${realPct}% real after ${inflationPct}% inflation), ${yearsUntilRetirement}y to retirement`}
        />
      </div>
      <RetirementAgeControl scenarios={props.scenarios} persons={props.persons} />
      <WithdrawalStrategyControl scenarios={props.scenarios} />
      <DrawdownTaxRateInline scenarios={props.scenarios} />
    </div>
  );
}
