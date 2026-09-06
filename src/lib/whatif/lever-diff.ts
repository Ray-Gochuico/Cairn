/**
 * W3 — lever classification, engine-effective assumption parity, and the
 * FULL-coverage lever diff (D-W3-8: summarizeLevers covers only 6 of the
 * payload's 17 keys; a review panel built on it would under-report).
 *
 * PURE: no stores, no clocks, no locale defaults. All phrases here are part
 * of the W3 copy contract (CR-P*, CR-L*, CR-MD2) — byte-frozen, advice-free.
 *
 * The two-list split is the spec §1.2 fixture: every LeverPayload key belongs
 * to exactly ONE list (completeness ratchet in lever-diff.test.ts) so a
 * future lever cannot silently escape both the parity table and the diff.
 */
import { formatCurrency } from '@/lib/format';
// Deep import (the FiCards.tsx:11-13 / scenario-assumptions.ts:4-5 precedent):
// the engine lib's index is byte-untouched this wave.
import { effectiveCashApy } from '@/lib/scenarios/effective-cash-apy';
import type { LeverPayload } from '@/lib/scenarios';
import type { Account, Household } from '@/types/schema';

/** Plans (moves) — the Main-difference section's subject. */
export const PLAN_LEVER_KEYS = [
  'extraLoanPayments', 'lumpSums', 'expensePeriods', 'income', 'contributions',
] as const;

/** Assumptions — yardstick clause 4's subject. */
export const ASSUMPTION_LEVER_KEYS = [
  'returns', 'inflation', 'swrOverride', 'withdrawalStrategy',
  'effectiveDrawdownTaxRate', 'retirementAgeOverride', 'expenseSource',
  'customMonthly', 'annualLongTermGains', 'annualQualifiedDividends',
  'annualNonQualifiedDividends', 'gapAllocation',
] as const;

/** Recursive sorted-key JSON — order-insensitive, byte-deterministic. */
export function canonicalJson(v: unknown): string {
  if (v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const rec = v as Record<string, unknown>;
    return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * The RealState slice the parity mirrors read — the ENGINE's own inputs,
 * never the display chain (D-W3-5). Renamed from EngineDefaults in C1 when
 * the cash-rate and retirement-age mirrors (CR-P3 / CR-P10, review chip
 * 2026-09-01) needed the persons and cash accounts the engine resolves
 * against. The page passes these from `real` (useRealState) — the same
 * RealState the projections above the card were run from.
 */
export interface EngineContext {
  /** RealState.defaults.inflation (the engine slice's settings leg). */
  inflation?: number | null;
  /** RealState.defaults.defaultDrawdownTaxRate. */
  defaultDrawdownTaxRate?: number | null;
  /** RealState.defaults.defaultCashApy — the per-account fallback APY
   *  (engine.ts:166-168 builds the settings shim from it). */
  defaultCashApy?: number | null;
  /** RealState.cashAccountsWithBalances — the balance-weighted APY leg the
   *  engine freezes at projection start (engine.ts:169-173). Empty ⇒ the
   *  engine grows cash at 0%. REQUIRED so a page cannot forget it (tsc). */
  cashAccountsWithBalances: ReadonlyArray<{ account: Account; balance: number }>;
  /** RealState.persons in engine order — each person's targetRetirementAge
   *  is the retirement-age fallback (engine.ts:517). Empty ⇒ no income is
   *  modeled, so the retirement age is engine-inert. REQUIRED (tsc). */
  persons: ReadonlyArray<{ targetRetirementAge?: number | null }>;
}

/** Mirrors effectiveSwr (src/lib/scenarios/effective-swr.ts) without a Scenario wrapper. Parity-tested. */
export function effectiveSwrOf(p: LeverPayload, household: Household | null): number {
  if (p.swrOverride != null) return p.swrOverride;
  if (household?.withdrawalRate != null && household.withdrawalRate > 0) return household.withdrawalRate;
  return 0.04;
}

/** Mirrors the inline drawdown fall-through at engine.ts:662-672 (rate > 0 wins; explicit 0 falls through). */
export function effectiveDrawdownTaxOf(p: LeverPayload, ctx: EngineContext): number {
  const own = p.effectiveDrawdownTaxRate ?? 0;
  return own > 0 ? own : ctx.defaultDrawdownTaxRate ?? 0;
}

/** Engine-effective BASELINE inflation: the inline slice at engine.ts:196-201
 *  (householdInflation deliberately null — parity must mirror that, or it
 *  would report a difference the projection doesn't have). */
export function engineBaselineInflationOf(p: LeverPayload, ctx: EngineContext): number {
  return p.inflation?.defaultRate ?? ctx.inflation ?? 0.03;
}

/** Engine-effective cash APY. engine.ts:158-173 builds a scenario shim and a
 *  settings shim and calls the SHIPPED resolver — so does this, with the same
 *  shim construction, so there is no second copy of the weighting math to
 *  drift. Parity-tested against a projectScenario run (lever-diff.test.ts). */
export function engineCashApyOf(p: LeverPayload, ctx: EngineContext): number {
  const scenarioShim = { leverPayload: p } as Parameters<typeof effectiveCashApy>[0];
  const settingsShim = ctx.defaultCashApy != null
    ? ({ defaultCashApy: ctx.defaultCashApy } as Parameters<typeof effectiveCashApy>[2])
    : null;
  return effectiveCashApy(scenarioShim, [...ctx.cashAccountsWithBalances], settingsShim);
}

/** Engine-effective retirement age PER PERSON — engine.ts:517:
 *  `payload.retirementAgeOverride ?? person.targetRetirementAge ?? null`.
 *  null = no retirement modeled for that person. Persons in engine order. */
export function engineRetirementAgesOf(p: LeverPayload, ctx: EngineContext): (number | null)[] {
  return ctx.persons.map((person) => p.retirementAgeOverride ?? person.targetRetirementAge ?? null);
}

export interface AssumptionParity {
  equal: boolean;
  /** CR-P phrases in contract order. */
  differences: string[];
  inflation: {
    aEffective: number; bEffective: number;
    aHasOverrides: boolean; bHasOverrides: boolean;
  };
}

const pct = (f: number): string => `${Number((f * 100).toFixed(2))}%`;
const money = (n: number): string => formatCurrency(Math.round(n));
const rateOrDefault = (r: number | null | undefined): string => (r == null ? 'default' : pct(r));

const EXPENSE_SOURCE_LABELS: Record<string, string> = {
  latestMonth: 'latest month',
  rolling12m: '12-month average',
  custom: 'custom',
};

export function computeAssumptionParity(
  a: LeverPayload,
  b: LeverPayload,
  household: Household | null,
  ctx: EngineContext,
): AssumptionParity {
  const d: string[] = [];
  const ra = a.returns;
  const rb = b.returns;
  if ((ra?.defaultRate ?? null) !== (rb?.defaultRate ?? null)) {
    d.push(`return ${rateOrDefault(ra?.defaultRate)} vs ${rateOrDefault(rb?.defaultRate)}`);
  }
  if (canonicalJson(ra?.overrides ?? {}) !== canonicalJson(rb?.overrides ?? {})) {
    d.push('year-specific return overrides differ');
  }
  // CR-P3 compares ENGINE-effective cash APY (C1; the CR-P5 pattern): a null
  // lever resolves to the balance-weighted account APY the engine freezes at
  // projection start (engine.ts:158-173), so `null` against that same number
  // is ONE rate to the projection. Both sides share the RealState, so the
  // fallback is the same number on both sides. The comparison is at the
  // RENDERED precision (D-C1-1): the weighted APY is arithmetic, and an
  // IEEE754 ulp between 0.043 typed into the lever and the computed average
  // must never print "cash rate 4.3% vs 4.3%".
  const cashA = pct(engineCashApyOf(a, ctx));
  const cashB = pct(engineCashApyOf(b, ctx));
  if (cashA !== cashB) d.push(`cash rate ${cashA} vs ${cashB}`);
  if ((ra?.compoundingFrequency ?? null) !== (rb?.compoundingFrequency ?? null)) {
    d.push(`compounding ${String(ra?.compoundingFrequency).toLowerCase()} vs ${String(rb?.compoundingFrequency).toLowerCase()}`);
  }
  // CR-P5 compares ENGINE-effective baseline inflation, not the raw lever
  // (review MINOR 7): the engine resolves payload → RealState defaults → 0.03
  // (engine.ts:196-201), so `{defaultRate: 0.03}` vs `null` under a 3%
  // Settings/app default is ONE number to the projection — claiming the plans
  // "differ in assumptions" there would be a difference the lines don't have.
  const infA = engineBaselineInflationOf(a, ctx);
  const infB = engineBaselineInflationOf(b, ctx);
  if (infA !== infB) d.push(`inflation ${pct(infA)} vs ${pct(infB)}`);
  if (canonicalJson(a.inflation?.overrides ?? {}) !== canonicalJson(b.inflation?.overrides ?? {})) {
    d.push('year-specific inflation overrides differ');
  }
  const swrA = effectiveSwrOf(a, household);
  const swrB = effectiveSwrOf(b, household);
  if (swrA !== swrB) d.push(`withdrawal rate ${pct(swrA)} vs ${pct(swrB)}`);
  if (a.withdrawalStrategy !== b.withdrawalStrategy) {
    d.push(`withdrawal strategy ${a.withdrawalStrategy} vs ${b.withdrawalStrategy}`);
  }
  // Engine-inert guard: the drawdown rate only ever applies to sequential
  // withdrawals (engine.ts:662-672) — a difference with both sides
  // proportional is a difference the projection doesn't have.
  const anySequential = a.withdrawalStrategy === 'sequential' || b.withdrawalStrategy === 'sequential';
  const ddA = effectiveDrawdownTaxOf(a, ctx);
  const ddB = effectiveDrawdownTaxOf(b, ctx);
  if (anySequential && ddA !== ddB) d.push(`drawdown tax ${pct(ddA)} vs ${pct(ddB)}`);
  // CR-P10 compares ENGINE-effective retirement ages PER PERSON (C1):
  // engine.ts:517 resolves `retirementAgeOverride ?? person.targetRetirementAge`
  // for each of real.persons, so an override equal to every person's own
  // target is no difference at all. With NO persons on file the field is
  // engine-inert, and the silence falls straight out of the per-person map —
  // both age lists are empty, so `some` is false; no length guard carries it
  // (review MINOR 7: the guard that used to sit here was an equivalent
  // mutant, and reading it as CR-P9's engine-inert clause was misleading).
  // Sides render the per-person ages joined ' / ' (the CR-MD2 raises idiom).
  // `default` is only reachable for a hand-built person with no target —
  // Zod-parsed persons always carry one (schema.ts:73).
  const agesA = engineRetirementAgesOf(a, ctx);
  const agesB = engineRetirementAgesOf(b, ctx);
  const ageLabel = (n: number | null): string => (n == null ? 'default' : String(n));
  if (agesA.some((age, i) => age !== agesB[i])) {
    d.push(`retirement age ${agesA.map(ageLabel).join(' / ')} vs ${agesB.map(ageLabel).join(' / ')}`);
  }
  if (a.expenseSource !== b.expenseSource) {
    d.push(`expenses base ${EXPENSE_SOURCE_LABELS[a.expenseSource] ?? a.expenseSource} vs ${EXPENSE_SOURCE_LABELS[b.expenseSource] ?? b.expenseSource}`);
  }
  // Engine-inert guard: customMonthly only feeds the engine when a side uses
  // the 'custom' expense source.
  const anyCustom = a.expenseSource === 'custom' || b.expenseSource === 'custom';
  if (anyCustom && (a.customMonthly ?? null) !== (b.customMonthly ?? null)) {
    d.push(`custom expenses ${money(a.customMonthly ?? 0)}/mo vs ${money(b.customMonthly ?? 0)}/mo`);
  }
  if ((a.annualLongTermGains ?? 0) !== (b.annualLongTermGains ?? 0)) {
    d.push(`long-term gains ${money(a.annualLongTermGains ?? 0)}/yr vs ${money(b.annualLongTermGains ?? 0)}/yr`);
  }
  if ((a.annualQualifiedDividends ?? 0) !== (b.annualQualifiedDividends ?? 0)) {
    d.push(`qualified dividends ${money(a.annualQualifiedDividends ?? 0)}/yr vs ${money(b.annualQualifiedDividends ?? 0)}/yr`);
  }
  if ((a.annualNonQualifiedDividends ?? 0) !== (b.annualNonQualifiedDividends ?? 0)) {
    d.push(`non-qualified dividends ${money(a.annualNonQualifiedDividends ?? 0)}/yr vs ${money(b.annualNonQualifiedDividends ?? 0)}/yr`);
  }
  if (canonicalJson(a.gapAllocation ?? null) !== canonicalJson(b.gapAllocation ?? null)) {
    d.push('surplus routing differs');
  }
  return {
    equal: d.length === 0,
    differences: d,
    inflation: {
      aEffective: engineBaselineInflationOf(a, ctx),
      bEffective: engineBaselineInflationOf(b, ctx),
      aHasOverrides: Object.keys(a.inflation?.overrides ?? {}).length > 0,
      bHasOverrides: Object.keys(b.inflation?.overrides ?? {}).length > 0,
    },
  };
}

// ── the plan-move diff ──────────────────────────────────────────────────────

export interface LeverDiff {
  onlyInA: string[];
  onlyInB: string[];
  /** Changed-in-both lines carrying full copy (CR-MD2). */
  changed: string[];
  isEmpty: boolean;
}

// Deliberate DUPLICATES of lever-summary.ts's module-private helpers
// (D-W3-P8: exporting them would touch a receipt-frozen file). Bodies are
// copied VERBATIM from lever-summary.ts:10-23; the phrase-parity tests in
// lever-diff.test.ts pin the two implementations together.
function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '+';
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}$${abs.toLocaleString('en-US')}`;
  return `${sign}$${abs}`;
}
const fmtMonth = (iso: string): string => iso.slice(0, 7);
const fmtPct0 = (f: number): string => `${(f * 100).toFixed(0)}%`;

type Elp = LeverPayload['extraLoanPayments'][number];
type Lump = LeverPayload['lumpSums'][number];
type ExpPeriod = LeverPayload['expensePeriods'][number];
type Contribution = LeverPayload['contributions'][number];
type PersonPlan = LeverPayload['income']['perPerson'][number];
type IncomeEvt = PersonPlan['events'][number];

// ── income shape is not a difference (smoke defect D1, 2026-09-02) ──────────
// The Income lever dialog normalizes income.perPerson into one entry PER
// PERSON, so a lever-identical twin can carry one entry on one side and two on
// the other. The engine resolves a missing entry as
//   payload.income.perPerson[idx] ?? payload.income.perPerson[0]
// (src/lib/scenarios/engine.ts:515), so ONE entry models the same raises and
// the same income events for every person that the same entry repeated does.
// Both sides are aligned to THAT rule before anything is compared — a
// shape-only difference is not a difference the projected lines have, and
// rendering it ("Annual raises: 0% vs 0% / 0%") was a false sentence.
/** The engine's fallback — MIRRORED, never invented. A padding default of
 *  "0% and no events" would report differences the projection does not have.
 *  The schema guarantees 1..2 entries after a Zod read (lever-types.ts:138),
 *  so EMPTY_PLAN is unreachable in practice and exists only so a hand-built
 *  payload cannot throw. */
const EMPTY_PLAN: PersonPlan = { annualRaiseRate: 0, events: [] };
function planAt(pp: readonly PersonPlan[], idx: number): PersonPlan {
  return pp[idx] ?? pp[0] ?? EMPTY_PLAN;
}
/** Both sides' per-person plans padded to the ENGINE's read width by that
 *  fallback. The width is one plan per PERSON ON FILE (engine.ts:515 reads
 *  perPerson[idx] for idx < real.persons.length), not per entry — entries
 *  past the person count are never read (C1). Without a person count (no
 *  engine context) every entry is compared. */
function alignedIncomePlans(
  a: LeverPayload,
  b: LeverPayload,
  personCount: number | undefined,
): { a: PersonPlan[]; b: PersonPlan[] } {
  const pa = a.income?.perPerson ?? [];
  const pb = b.income?.perPerson ?? [];
  const n = personCount ?? Math.max(pa.length, pb.length);
  const pad = (pp: readonly PersonPlan[]): PersonPlan[] =>
    pp.length === 0 ? [] : Array.from({ length: n }, (_, i) => planAt(pp, i));
  return { a: pad(pa), b: pad(pb) };
}

// Phrase shapes CR-L1..CR-L5 — mirror lever-summary.ts:25-74 byte-for-byte
// where the lever is one summarizeLevers reports (loan / lump / expense /
// contribution / raises); income events are NEW coverage in the same register.
function loanPhrase(e: Elp, loanNames: Record<number, string>): string {
  const name = loanNames[e.loanId] ?? `Loan #${e.loanId}`;
  const window =
    e.start || e.end
      ? `${e.start ? fmtMonth(e.start) : '∞'} → ${e.end ? fmtMonth(e.end) : '∞'}`
      : 'Always';
  return `${formatMoney(e.extraMonthly)}/mo on ${name} (${window})`;
}
function lumpPhrase(e: Lump): string {
  const tag = e.label ?? (e.destination === 'cash' ? 'cash' : 'investments');
  return `Lump sum ${fmtMonth(e.when)}: ${formatMoney(e.amount)}${tag ? ` (${tag})` : ''}`;
}
function expensePhrase(e: ExpPeriod): string {
  const labelSuffix = e.label ? ` (${e.label})` : '';
  return `Expenses ${fmtMonth(e.start)} × ${e.durationMonths}mo: ${formatMoney(e.monthlyDelta)}/mo${labelSuffix}`;
}
function contributionPhrase(c: Contribution): string {
  const startYear = Math.floor(c.startMonth / 12) + 1;
  const endYear = c.endMonth === null ? '∞' : Math.floor(c.endMonth / 12) + 1;
  return `Contribute ${formatMoney(c.monthlyAmount)}/mo (Y${startYear}-${endYear})`;
}
function incomeEventPhrase(e: IncomeEvt, personIdx: number, personCount: number): string {
  const suffix =
    e.type === 'raise' ? ` ${formatMoney(e.deltaAmount)}`
    : e.type === 'sabbatical' ? ` ${e.durationMonths}mo`
    : ` to ${formatCurrency(Math.round(e.newSalary))}/yr`;
  const person = personCount > 1 ? ` (person ${personIdx + 1})` : '';
  return `Income event ${fmtMonth(e.when)}: ${e.type}${suffix}${person}`;
}

export interface LeverDiffContext {
  loanNames: Record<number, string>;
  /** RealState.persons.length — the engine's read width for income.perPerson
   *  (engine.ts:515). The page always passes it (derived from
   *  EngineContext.persons in CompareScenariosCard); omitted ⇒ every entry
   *  is compared. */
  personCount?: number;
}

export function buildLeverDiff(
  a: LeverPayload,
  b: LeverPayload,
  ctx: LeverDiffContext,
): LeverDiff {
  const aligned = alignedIncomePlans(a, b, ctx.personCount);
  const entries = (p: LeverPayload, pp: PersonPlan[]): Map<string, string> => {
    const m = new Map<string, string>();
    for (const e of p.extraLoanPayments ?? []) m.set(`elp:${canonicalJson(e)}`, loanPhrase(e, ctx.loanNames));
    for (const e of p.lumpSums ?? []) m.set(`lump:${canonicalJson(e)}`, lumpPhrase(e));
    for (const e of p.expensePeriods ?? []) m.set(`exp:${canonicalJson(e)}`, expensePhrase(e));
    pp.forEach((person, i) => {
      for (const e of person.events ?? []) {
        m.set(`inc:${i}:${canonicalJson(e)}`, incomeEventPhrase(e, i, pp.length));
      }
    });
    for (const c of p.contributions ?? []) m.set(`contrib:${canonicalJson(c)}`, contributionPhrase(c));
    return m;
  };
  const ma = entries(a, aligned.a);
  const mb = entries(b, aligned.b);
  const rawA: string[] = [];
  const rawB: string[] = [];
  for (const [k, phrase] of ma) if (!mb.has(k)) rawA.push(phrase);
  for (const [k, phrase] of mb) if (!ma.has(k)) rawB.push(phrase);
  // CR-L6: identical phrase on both only-in lists = same-looking move whose
  // details differ — mark BOTH so neither side reads as an extra move.
  const collide = new Set(rawA.filter((p) => rawB.includes(p)));
  const mark = (list: string[]): string[] => list.map((p) => (collide.has(p) ? `${p} (details differ)` : p));
  const changed: string[] = [];
  // CR-MD2 compares the ALIGNED per-person rates positionally — one entry vs
  // the same entry repeated is one rate to the engine, so it renders nothing.
  // Rendering keeps the frozen format ('{a} vs {b}', each side per-person
  // fmtPct0 joined ' / ') over the same aligned lists, so both sides always
  // carry the same number of figures.
  const raisesOf = (pp: PersonPlan[]): string =>
    pp.map((x) => fmtPct0(x.annualRaiseRate ?? 0)).join(' / ');
  const raisesA = raisesOf(aligned.a);
  const raisesB = raisesOf(aligned.b);
  if (raisesA !== raisesB) changed.push(`Annual raises: ${raisesA} vs ${raisesB}`);
  const onlyInA = mark(rawA);
  const onlyInB = mark(rawB);
  return {
    onlyInA, onlyInB, changed,
    isEmpty: onlyInA.length === 0 && onlyInB.length === 0 && changed.length === 0,
  };
}
