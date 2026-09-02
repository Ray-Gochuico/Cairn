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
import type { LeverPayload } from '@/lib/scenarios';
import type { Household } from '@/types/schema';

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

export interface EngineDefaults {
  /** RealState.defaults.inflation (the engine slice's settings leg). */
  inflation?: number | null;
  /** RealState.defaults.defaultDrawdownTaxRate. */
  defaultDrawdownTaxRate?: number | null;
}

/** Mirrors effectiveSwr (src/lib/scenarios/effective-swr.ts) without a Scenario wrapper. Parity-tested. */
export function effectiveSwrOf(p: LeverPayload, household: Household | null): number {
  if (p.swrOverride != null) return p.swrOverride;
  if (household?.withdrawalRate != null && household.withdrawalRate > 0) return household.withdrawalRate;
  return 0.04;
}

/** Mirrors the inline drawdown fall-through at engine.ts:662-672 (rate > 0 wins; explicit 0 falls through). */
export function effectiveDrawdownTaxOf(p: LeverPayload, defaults: EngineDefaults): number {
  const own = p.effectiveDrawdownTaxRate ?? 0;
  return own > 0 ? own : defaults.defaultDrawdownTaxRate ?? 0;
}

/** Engine-effective BASELINE inflation: the inline slice at engine.ts:196-201
 *  (householdInflation deliberately null — parity must mirror that, or it
 *  would report a difference the projection doesn't have). */
export function engineBaselineInflationOf(p: LeverPayload, defaults: EngineDefaults): number {
  return p.inflation?.defaultRate ?? defaults.inflation ?? 0.03;
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
  defaults: EngineDefaults,
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
  const cashLabel = (r: number | null | undefined): string => (r == null ? 'default APY' : pct(r));
  if ((ra?.cashRate ?? null) !== (rb?.cashRate ?? null)) {
    d.push(`cash rate ${cashLabel(ra?.cashRate)} vs ${cashLabel(rb?.cashRate)}`);
  }
  if ((ra?.compoundingFrequency ?? null) !== (rb?.compoundingFrequency ?? null)) {
    d.push(`compounding ${String(ra?.compoundingFrequency).toLowerCase()} vs ${String(rb?.compoundingFrequency).toLowerCase()}`);
  }
  // CR-P5 compares ENGINE-effective baseline inflation, not the raw lever
  // (review MINOR 7): the engine resolves payload → RealState defaults → 0.03
  // (engine.ts:196-201), so `{defaultRate: 0.03}` vs `null` under a 3%
  // Settings/app default is ONE number to the projection — claiming the plans
  // "differ in assumptions" there would be a difference the lines don't have.
  const infA = engineBaselineInflationOf(a, defaults);
  const infB = engineBaselineInflationOf(b, defaults);
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
  const ddA = effectiveDrawdownTaxOf(a, defaults);
  const ddB = effectiveDrawdownTaxOf(b, defaults);
  if (anySequential && ddA !== ddB) d.push(`drawdown tax ${pct(ddA)} vs ${pct(ddB)}`);
  const ageLabel = (n: number | null | undefined): string => (n == null ? 'default' : String(n));
  if ((a.retirementAgeOverride ?? null) !== (b.retirementAgeOverride ?? null)) {
    d.push(`retirement age ${ageLabel(a.retirementAgeOverride)} vs ${ageLabel(b.retirementAgeOverride)}`);
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
      aEffective: engineBaselineInflationOf(a, defaults),
      bEffective: engineBaselineInflationOf(b, defaults),
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
type IncomeEvt = LeverPayload['income']['perPerson'][number]['events'][number];

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

export function buildLeverDiff(
  a: LeverPayload,
  b: LeverPayload,
  ctx: { loanNames: Record<number, string> },
): LeverDiff {
  const entries = (p: LeverPayload): Map<string, string> => {
    const m = new Map<string, string>();
    for (const e of p.extraLoanPayments ?? []) m.set(`elp:${canonicalJson(e)}`, loanPhrase(e, ctx.loanNames));
    for (const e of p.lumpSums ?? []) m.set(`lump:${canonicalJson(e)}`, lumpPhrase(e));
    for (const e of p.expensePeriods ?? []) m.set(`exp:${canonicalJson(e)}`, expensePhrase(e));
    const pp = p.income?.perPerson ?? [];
    pp.forEach((person, i) => {
      for (const e of person.events ?? []) {
        m.set(`inc:${i}:${canonicalJson(e)}`, incomeEventPhrase(e, i, pp.length));
      }
    });
    for (const c of p.contributions ?? []) m.set(`contrib:${canonicalJson(c)}`, contributionPhrase(c));
    return m;
  };
  const ma = entries(a);
  const mb = entries(b);
  const rawA: string[] = [];
  const rawB: string[] = [];
  for (const [k, phrase] of ma) if (!mb.has(k)) rawA.push(phrase);
  for (const [k, phrase] of mb) if (!ma.has(k)) rawB.push(phrase);
  // CR-L6: identical phrase on both only-in lists = same-looking move whose
  // details differ — mark BOTH so neither side reads as an extra move.
  const collide = new Set(rawA.filter((p) => rawB.includes(p)));
  const mark = (list: string[]): string[] => list.map((p) => (collide.has(p) ? `${p} (details differ)` : p));
  const changed: string[] = [];
  const raisesOf = (p: LeverPayload): string =>
    (p.income?.perPerson ?? []).map((x) => fmtPct0(x.annualRaiseRate ?? 0)).join(' / ');
  if (raisesOf(a) !== raisesOf(b)) changed.push(`Annual raises: ${raisesOf(a)} vs ${raisesOf(b)}`);
  const onlyInA = mark(rawA);
  const onlyInB = mark(rawB);
  return {
    onlyInA, onlyInB, changed,
    isEmpty: onlyInA.length === 0 && onlyInB.length === 0 && changed.length === 0,
  };
}
