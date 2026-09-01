/**
 * W3 §3 — "What the model doesn't know yet": the DYNAMIC your-data register
 * (the page footer's "What this projection doesn't model" remains the STATIC
 * model-limitations register; no overlap).
 *
 * D-W3-13: a row renders only while its condition holds; zero rows ⇒ the card
 * does not render. Absence is the calm outcome. No percentages, no counts,
 * no urgency vocabulary. One link per row to the one-place-per-thing home
 * (the AssumeRow.cta {label, to} shape).
 *
 * CI-26b: conditions for G2/G4/G5/G6 ARE the canonical provenance strings
 * from buildScenarioDefaults — the row copy embeds them verbatim, and a
 * canonical-string rename upstream breaks these conditions loudly (test).
 *
 * G7 (inflation app-default) is deliberately ABSENT — D-W3-P1: unreachable
 * with a household present (Household.inflationAssumption is non-nullable).
 *
 * PURE: todayIso injected; the only Date construction is from that ISO.
 */
import { buildScenarioDefaults } from '@/lib/calculators/scenario-assumptions';
import { monthlyInputPendingFor } from '@/lib/input-pending';
import type { LeverPayload } from '@/lib/scenarios';
import type { Account, AccountSnapshot, AppSettings, Contribution, Household, Person } from '@/types/schema';

export interface ModelGapRow {
  /** 'G1'…'G10'; G8 rows are 'G8:{personId}'. */
  id: string;
  text: string;
  cta: { label: string; to: string };
}
export interface ModelGapsModel { rows: ModelGapRow[] }

export interface ModelGapsSide { name: string; payload: LeverPayload }

export interface ModelGapsInput {
  household: Household | null;
  settings: AppSettings | null;
  persons: Person[];
  accounts: Account[];
  snapshots: AccountSnapshot[];
  contributions: Contribution[];
  /** ≥1 roadmap rule-engine node with status 'unanswered' (page computes via
   *  evaluate(useRoadmap()); false when the roadmap context is unavailable). */
  roadmapHasUnanswered: boolean;
  /** The compared pair (2 entries) or the only scenario (1). */
  sides: ModelGapsSide[];
  /** 'YYYY-MM-DD' — injected; the lib never reads a clock. */
  todayIso: string;
}

const OPEN_HOUSEHOLD = { label: 'Open Household →', to: '/inputs/household' } as const;
const OPEN_SETTINGS = { label: 'Open Settings →', to: '/settings' } as const;

export function buildModelGaps(i: ModelGapsInput): ModelGapsModel {
  const rows: ModelGapRow[] = [];
  const { provenance } = buildScenarioDefaults({
    household: i.household, settings: i.settings, accounts: i.accounts,
    snapshots: i.snapshots, contributions: i.contributions, todayIso: i.todayIso,
  });
  if (i.household != null && i.household.monthlyExpenseBaseline <= 0) {
    rows.push({ id: 'G1', text: "No monthly expense baseline — FI dates can't be computed, so they aren't shown.", cta: OPEN_HOUSEHOLD });
  }
  if (provenance.portfolio === 'no account snapshots yet') {
    rows.push({ id: 'G2', text: 'No account snapshots yet — the portfolio starts at $0 in these projections.', cta: { label: 'Open Accounts →', to: '/investments?manage=accounts' } });
  }
  if (monthlyInputPendingFor(new Date(`${i.todayIso}T12:00:00Z`), i.accounts, i.snapshots)) {
    rows.push({ id: 'G3', text: "Last month's balances aren't confirmed — lines start from the latest figures you've confirmed.", cta: { label: 'Open monthly check-in →', to: '/monthly' } });
  }
  if (provenance.annualContribution === 'no contributions in the last 12 months') {
    rows.push({ id: 'G4', text: 'No contributions in the last 12 months — ongoing contributions enter these prefills as $0.', cta: { label: 'Open Contributions →', to: '/investments?manage=contributions' } });
  }
  if (provenance.returnPct === 'app default 6%') {
    rows.push({ id: 'G5', text: 'Growth rate: app default 6% — no growth scenarios set.', cta: OPEN_HOUSEHOLD });
  }
  if (provenance.swrPct === 'app default 4%') {
    rows.push({ id: 'G6', text: 'Withdrawal rate: app default 4% — not set in Inputs.', cta: OPEN_HOUSEHOLD });
  }
  // D-W3-P5: a zero salary alone is legitimate for HOURLY employees — the
  // employment test guards on both fields, mirroring Section1_WhoYouAre.
  const noIncome = i.persons
    .filter((p) => (p.annualSalaryPretax ?? 0) <= 0 && (p.hourlyRate ?? 0) <= 0)
    .sort((x, y) => (x.id ?? 0) - (y.id ?? 0));
  for (const p of noIncome) {
    rows.push({ id: `G8:${p.id ?? p.name}`, text: `${p.name} has no salary entered — the projection carries no income for them.`, cta: { label: 'Open Persons →', to: '/inputs/persons' } });
  }
  if (i.roadmapHasUnanswered) {
    rows.push({ id: 'G9', text: "The roadmap has questions you haven't answered — its checklist and frameworks assume less until you do.", cta: { label: 'Open Roadmap →', to: '/roadmap' } });
  }
  // D-W3-P6: engine truth (engine.ts:662-672) — a payload rate > 0 means the
  // tax IS modeled, and the parameter is inert unless a side is sequential.
  if (i.settings?.defaultDrawdownTaxRate == null && i.sides.length > 0) {
    const qualifies = (s: ModelGapsSide): boolean =>
      s.payload.withdrawalStrategy === 'sequential' && (s.payload.effectiveDrawdownTaxRate ?? 0) <= 0;
    const q = i.sides.filter(qualifies);
    if (q.length === i.sides.length) {
      rows.push({ id: 'G10', text: "Drawdown tax rate isn't set — sequential withdrawals are modeled untaxed.", cta: OPEN_SETTINGS });
    } else if (q.length === 1 && i.sides.length === 2) {
      rows.push({ id: 'G10', text: `Drawdown tax rate isn't set — ${q[0].name}'s sequential withdrawals are modeled untaxed.`, cta: OPEN_SETTINGS });
    }
  }
  return { rows };
}
