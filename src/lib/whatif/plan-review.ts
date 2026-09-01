/**
 * W3 — the deterministic plan-review model (Compare scenarios card).
 *
 * TRACEABILITY (claim → engine evidence; the adversarial reviewer re-derives
 * every sentence from these fields alone):
 *   Y1            one RealState per render feeds projectedScenarios(real);
 *                 realFingerprint keys the cache; taxBrackets frozen at start
 *   Y2            scenarios-store dollarMode + horizonMonths (store-level,
 *                 shared by every plotted line)
 *   Y3 (+a/b)     WhatIf displayInflation (effectiveBaselineInflation) vs
 *                 each side's engineBaselineInflationOf (engine.ts:196-201)
 *   Y4            computeAssumptionParity over the ASSUMPTION_LEVER_KEYS
 *   BL1/BL2/TR-FI Milestones.financialIndependenceISO (detectMilestones)
 *   BL3/TR-NW     Milestones.netWorth30y, displayed via the fmtNetWorth30y
 *                 recipe (ManageScenariosModal.tsx:39-44); floor = the
 *                 briefing NET_WORTH_FLOOR recipe over the display values
 *   BL4/TR-DEBT   Milestones.debtFreeISO
 *   BL5           canonicalJson payload equality (identical payload + same
 *                 RealState ⇒ identical cache key ⇒ identical states)
 *   TR-DRAW       first MonthlyState with (withdrawnFromInvestments ?? 0) > 0
 *   TR-RET        Milestones.retirementISO
 *   MD-*          buildLeverDiff over the PLAN_LEVER_KEYS
 *
 * NEVER cited: withdrawalTaxAccrued (not deflated by toReal — D-W3-15),
 * total interest (not a MonthlyState output), IRS caps (the engine has none).
 *
 * PURE + byte-deterministic: no stores, no clocks, fixed-locale formatters,
 * fixed template registry (D-W3-9). All copy is the W3 contract (CR-*).
 */
import { formatCurrency } from '@/lib/format';
import { NET_WORTH_FLOOR_ABS, NET_WORTH_FLOOR_PCT } from '@/lib/briefing';
import type { LeverPayload, Milestones, MonthlyState } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';
import type { AppSettings, Household } from '@/types/schema';
import type { DollarMode } from '@/stores/scenarios-store';
import { canonicalJson, type AssumptionParity, type LeverDiff } from './lever-diff';

// ── model shapes (briefing.ts BriefingRowPart precedent) ────────────────────

export interface ReviewLine { parts: { text: string; emphasis?: boolean }[] }

/** Plain-join — tests, aria, copy review (the briefingRowText affordance). */
export function lineText(l: ReviewLine): string {
  return l.parts.map((p) => p.text).join('');
}

export interface PlanReviewModel {
  yardstick: ReviewLine[];
  bottomLine: ReviewLine;
  tradeoffs: ReviewLine[];
  mainDifference: ReviewLine[];
  footer: string;
}

export interface CompareSide {
  name: string;
  payload: LeverPayload;
  states: MonthlyState[];
  milestones: Milestones;
}

export interface PlanReviewInput {
  a: CompareSide;
  b: CompareSide;
  dollarMode: DollarMode;
  horizonMonths: number;
  deflator: { rate: number; sourceLabel: string };
  parity: AssumptionParity;
  leverDiff: LeverDiff;
}

// ── fixed copy (CR-10, CR-8, CR-8c) ─────────────────────────────────────────

export const COMPARE_FOOTER =
  'A mechanical comparison of two scenarios you built — not advice, not a recommendation.';
export const SECOND_SCENARIO_PROMPT =
  'Save a second scenario to compare plans side by side.';
export const SEND_POINTER = 'Calculators can send a scenario here, too.';

// ── deterministic formatting helpers ────────────────────────────────────────

const t = (text: string): { text: string } => ({ text });
const em = (text: string): { text: string; emphasis: true } => ({ text, emphasis: true });
const money = (n: number): string => formatCurrency(Math.round(n));
const pct = (f: number): string => `${Number((f * 100).toFixed(2))}%`;
const nMonths = (n: number): string => `${n} month${n === 1 ? '' : 's'}`;
/** 'YYYY-MM' → 'June 2040' — the effects.ts fixed-locale idiom. */
const monthYearYm = (ym: string): string =>
  new Date(`${ym}-01T12:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthsBetweenYm = (a: string, b: string): number =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
const horizonPhrase = (m: number): string => (m % 12 === 0 ? `${m / 12} years` : `${m} months`);
const horizonClause = (m: number): string =>
  m >= 360 ? 'at the 30-year mark'
  : m % 12 === 0 ? `at the end of your ${m / 12}-year horizon`
  : `at the end of your ${m}-month horizon`;

// ── the fixed template registry (D-W3-9) ────────────────────────────────────

export const TEMPLATES = {
  Y1: (): ReviewLine => ({ parts: [t('Same data: both lines start from one capture of your data — the same accounts, balances, loans, incomes, and tax brackets.')] }),
  Y2: (s: { basis: string; horizon: string }): ReviewLine => ({
    parts: [t('Same yardstick: dollars are '), em(s.basis), t(' and the horizon is '), em(s.horizon), t(' — for every line on this chart.')],
  }),
  Y4_EQUAL: (): ReviewLine => ({ parts: [t('Return, inflation, withdrawal, and tax assumptions are identical — the differences below come only from the plan levers.')] }),
  Y4_DIFFER: (s: { list: string }): ReviewLine => ({
    parts: [t('These plans differ in assumptions, not just moves: '), em(s.list), t('.')],
  }),
  BL1: (s: { earlierName: string; months: number; earlierLabel: string; laterLabel: string }): ReviewLine => ({
    parts: [t(`${s.earlierName} reaches the FI mark `), em(nMonths(s.months)), t(' earlier — '), em(s.earlierLabel), t(' vs '), em(s.laterLabel), t('.')],
  }),
  BL2: (s: { yesName: string; monthLabel: string; noName: string }): ReviewLine => ({
    parts: [t(`${s.yesName} reaches the FI mark within the horizon (`), em(s.monthLabel), t(`); ${s.noName} doesn't.`)],
  }),
  BL3: (s: { higherName: string; delta: string; horizonClause: string; basisSuffix: string }): ReviewLine => ({
    parts: [t(`${s.higherName} ends `), em(s.delta), t(` higher ${s.horizonClause}${s.basisSuffix}.`)],
  }),
  BL4: (s: { earlierName: string; months: number; earlierLabel: string; laterLabel: string }): ReviewLine => ({
    parts: [t(`${s.earlierName} is debt-free `), em(nMonths(s.months)), t(' earlier — '), em(s.earlierLabel), t(' vs '), em(s.laterLabel), t('.')],
  }),
  BL5: (): ReviewLine => ({ parts: [t('These two scenarios are identical — their lines overlap.')] }),
  BL6: (s: { floor: string }): ReviewLine => ({
    parts: [t('These plans end within '), em(s.floor), t(' of each other over this horizon.')],
  }),
  TR_DEBT1: (s: { yesName: string; monthLabel: string; noName: string }): ReviewLine => ({
    parts: [t(`${s.yesName} is debt-free by `), em(s.monthLabel), t(`; ${s.noName} still carries debt at the end of the horizon.`)],
  }),
  TR_DRAW2: (s: { firstName: string; firstLabel: string; secondName: string; secondLabel: string }): ReviewLine => ({
    parts: [t(`${s.firstName} starts drawing from investments in `), em(s.firstLabel), t(`; ${s.secondName} in `), em(s.secondLabel), t('.')],
  }),
  TR_DRAW1: (s: { name: string; monthLabel: string; otherName: string }): ReviewLine => ({
    parts: [t(`${s.name} starts drawing from investments in `), em(s.monthLabel), t(`; ${s.otherName} doesn't within the horizon.`)],
  }),
  TR_RET2: (s: { aLabel: string; aName: string; bLabel: string; bName: string }): ReviewLine => ({
    parts: [t('Salary income ends '), em(s.aLabel), t(` in ${s.aName} and `), em(s.bLabel), t(` in ${s.bName}.`)],
  }),
  TR_RET1: (s: { monthLabel: string; name: string; otherName: string }): ReviewLine => ({
    parts: [t('Salary income ends '), em(s.monthLabel), t(` in ${s.name}; in ${s.otherName} it continues through the horizon.`)],
  }),
  MD_ONLY: (s: { name: string; phrase: string }): ReviewLine => ({
    parts: [t(`Only in ${s.name}: `), em(s.phrase)],
  }),
  MD_CHANGED: (s: { line: string }): ReviewLine => ({ parts: [em(s.line)] }),
  MD_XREF: (): ReviewLine => ({ parts: [t('Assumption differences are listed under Same yardstick above.')] }),
  MD_NONE: (): ReviewLine => ({ parts: [t('No differences — see the bottom line.')] }),
  MD_ASSUMPTIONS_ONLY: (): ReviewLine => ({ parts: [t("The plans' moves are identical — only the assumptions above differ.")] }),
  UNAVAILABLE: (s: { names: string }): ReviewLine => ({ parts: [t(`Projection unavailable for ${s.names}.`)] }),
} as const;

// ── selection machinery ─────────────────────────────────────────────────────

type BottomId = 'BL1' | 'BL2' | 'BL3' | 'BL4' | 'BL5' | 'BL6';
interface Chosen { id: BottomId; line: ReviewLine }

function fiPair(i: PlanReviewInput): Chosen | null {
  const fa = i.a.milestones.financialIndependenceISO ?? null;
  const fb = i.b.milestones.financialIndependenceISO ?? null;
  if (fa != null && fb != null && fa !== fb) {
    const [e, l] = fa < fb
      ? [{ name: i.a.name, iso: fa }, { name: i.b.name, iso: fb }]
      : [{ name: i.b.name, iso: fb }, { name: i.a.name, iso: fa }];
    return { id: 'BL1', line: TEMPLATES.BL1({ earlierName: e.name, months: monthsBetweenYm(e.iso, l.iso), earlierLabel: monthYearYm(e.iso), laterLabel: monthYearYm(l.iso) }) };
  }
  if ((fa != null) !== (fb != null)) {
    const yes = fa != null ? { name: i.a.name, iso: fa } : { name: i.b.name, iso: fb as string };
    return { id: 'BL2', line: TEMPLATES.BL2({ yesName: yes.name, monthLabel: monthYearYm(yes.iso), noName: fa != null ? i.b.name : i.a.name }) };
  }
  return null;
}

interface NwDelta { floor: number; absDelta: number; higherName: string }
function nwDelta(i: PlanReviewInput): NwDelta | null {
  const na = i.a.milestones.netWorth30y;
  const nb = i.b.milestones.netWorth30y;
  if (na == null || nb == null) return null;
  // The fmtNetWorth30y display recipe (ManageScenariosModal.tsx:39-44) —
  // parity with the scoreboard column, D-W3-4 / D-W3-P7.
  const disp = (n: number): number => (i.dollarMode === 'real' ? n / Math.pow(1 + i.deflator.rate, 30) : n);
  const da = disp(na);
  const db = disp(nb);
  return {
    floor: Math.max(NET_WORTH_FLOOR_ABS, NET_WORTH_FLOOR_PCT * Math.max(Math.abs(da), Math.abs(db))),
    absDelta: Math.abs(da - db),
    higherName: da >= db ? i.a.name : i.b.name,
  };
}

const basisSuffix = (i: PlanReviewInput): string => (i.dollarMode === 'real' ? " (today's dollars)" : '');

function debtPairBoth(i: PlanReviewInput): Chosen | null {
  const da = i.a.milestones.debtFreeISO ?? null;
  const db = i.b.milestones.debtFreeISO ?? null;
  if (da != null && db != null && da !== db) {
    const [e, l] = da < db
      ? [{ name: i.a.name, iso: da }, { name: i.b.name, iso: db }]
      : [{ name: i.b.name, iso: db }, { name: i.a.name, iso: da }];
    return { id: 'BL4', line: TEMPLATES.BL4({ earlierName: e.name, months: monthsBetweenYm(e.iso, l.iso), earlierLabel: monthYearYm(e.iso), laterLabel: monthYearYm(l.iso) }) };
  }
  return null;
}

function chooseBottomLine(i: PlanReviewInput): Chosen {
  const fi = fiPair(i);
  if (fi) return fi;
  const nw = nwDelta(i);
  if (nw && nw.absDelta >= nw.floor) {
    return { id: 'BL3', line: TEMPLATES.BL3({ higherName: nw.higherName, delta: money(nw.absDelta), horizonClause: horizonClause(i.horizonMonths), basisSuffix: basisSuffix(i) }) };
  }
  const debt = debtPairBoth(i);
  if (debt) return debt;
  if (canonicalJson(i.a.payload) === canonicalJson(i.b.payload)) {
    return { id: 'BL5', line: TEMPLATES.BL5() };
  }
  return { id: 'BL6', line: TEMPLATES.BL6({ floor: money(nw ? nw.floor : NET_WORTH_FLOOR_ABS) }) };
}

const firstDrawYm = (states: MonthlyState[]): string | null =>
  states.find((s) => (s.withdrawnFromInvestments ?? 0) > 0)?.monthISO ?? null;

function tradeoffLines(i: PlanReviewInput, bottom: Chosen): ReviewLine[] {
  const cands: ReviewLine[] = [];
  if (bottom.id !== 'BL1' && bottom.id !== 'BL2') {
    const fi = fiPair(i);
    if (fi) cands.push(fi.line);
  }
  const debt = debtPairBoth(i);
  if (debt && bottom.id !== 'BL4') cands.push(debt.line);
  else if (!debt) {
    const da = i.a.milestones.debtFreeISO ?? null;
    const db = i.b.milestones.debtFreeISO ?? null;
    if ((da != null) !== (db != null)) {
      const yes = da != null ? { name: i.a.name, iso: da } : { name: i.b.name, iso: db as string };
      cands.push(TEMPLATES.TR_DEBT1({ yesName: yes.name, monthLabel: monthYearYm(yes.iso), noName: da != null ? i.b.name : i.a.name }));
    }
  }
  if (bottom.id !== 'BL3') {
    const nw = nwDelta(i);
    if (nw && nw.absDelta >= nw.floor) {
      cands.push(TEMPLATES.BL3({ higherName: nw.higherName, delta: money(nw.absDelta), horizonClause: horizonClause(i.horizonMonths), basisSuffix: basisSuffix(i) }));
    }
  }
  const wa = firstDrawYm(i.a.states);
  const wb = firstDrawYm(i.b.states);
  if (wa != null && wb != null && wa !== wb) {
    const [f, s2] = wa < wb
      ? [{ name: i.a.name, iso: wa }, { name: i.b.name, iso: wb }]
      : [{ name: i.b.name, iso: wb }, { name: i.a.name, iso: wa }];
    cands.push(TEMPLATES.TR_DRAW2({ firstName: f.name, firstLabel: monthYearYm(f.iso), secondName: s2.name, secondLabel: monthYearYm(s2.iso) }));
  } else if ((wa != null) !== (wb != null)) {
    const yes = wa != null ? { name: i.a.name, iso: wa } : { name: i.b.name, iso: wb as string };
    cands.push(TEMPLATES.TR_DRAW1({ name: yes.name, monthLabel: monthYearYm(yes.iso), otherName: wa != null ? i.b.name : i.a.name }));
  }
  const ra = i.a.milestones.retirementISO ?? null;
  const rb = i.b.milestones.retirementISO ?? null;
  if (ra != null && rb != null && ra !== rb) {
    cands.push(TEMPLATES.TR_RET2({ aLabel: monthYearYm(ra), aName: i.a.name, bLabel: monthYearYm(rb), bName: i.b.name }));
  } else if ((ra != null) !== (rb != null)) {
    const yes = ra != null ? { name: i.a.name, iso: ra } : { name: i.b.name, iso: rb as string };
    cands.push(TEMPLATES.TR_RET1({ monthLabel: monthYearYm(yes.iso), name: yes.name, otherName: ra != null ? i.b.name : i.a.name }));
  }
  // Dedupe by rendered text (framework-cards idiom), seeded with the bottom
  // line so a tradeoff can never repeat it; structural cap at 4 (§1.4).
  const seen = new Set<string>([lineText(bottom.line)]);
  const out: ReviewLine[] = [];
  for (const l of cands) {
    const txt = lineText(l);
    if (!seen.has(txt)) { seen.add(txt); out.push(l); }
  }
  return out.slice(0, 4);
}

function mainDifferenceLines(i: PlanReviewInput): ReviewLine[] {
  const d = i.leverDiff;
  if (d.isEmpty) return [i.parity.equal ? TEMPLATES.MD_NONE() : TEMPLATES.MD_ASSUMPTIONS_ONLY()];
  const out: ReviewLine[] = [];
  for (const p of d.onlyInB) out.push(TEMPLATES.MD_ONLY({ name: i.b.name, phrase: p }));
  for (const p of d.onlyInA) out.push(TEMPLATES.MD_ONLY({ name: i.a.name, phrase: p }));
  for (const c of d.changed) out.push(TEMPLATES.MD_CHANGED({ line: c }));
  if (!i.parity.equal) out.push(TEMPLATES.MD_XREF());
  return out;
}

function deflatorLine(i: PlanReviewInput): ReviewLine {
  const x = pct(i.deflator.rate);
  const parts: ReviewLine['parts'] = [
    t("One deflator: today's-dollar conversion uses one inflation rate — "),
    em(x),
    t(`, ${i.deflator.sourceLabel} — applied to every line.`),
  ];
  const sides = [
    { name: i.a.name, eff: i.parity.inflation.aEffective, ov: i.parity.inflation.aHasOverrides },
    { name: i.b.name, eff: i.parity.inflation.bEffective, ov: i.parity.inflation.bHasOverrides },
  ];
  for (const s of sides) {
    if (s.ov) {
      parts.push(t(` ${s.name} carries year-specific inflation overrides but is deflated at a flat `), em(x), t(' here.'));
    } else if (s.eff !== i.deflator.rate) {
      parts.push(t(` ${s.name} is projected at `), em(pct(s.eff)), t(' inflation but deflated at '), em(x), t(' here.'));
    }
  }
  return { parts };
}

export function buildPlanReview(i: PlanReviewInput): PlanReviewModel {
  const basis = i.dollarMode === 'real' ? "real (today's dollars)" : 'nominal';
  const y2 = TEMPLATES.Y2({ basis, horizon: horizonPhrase(i.horizonMonths) });
  const aEmpty = i.a.states.length === 0;
  const bEmpty = i.b.states.length === 0;
  if (aEmpty || bEmpty) {
    const names = aEmpty && bEmpty ? `${i.a.name} and ${i.b.name}` : aEmpty ? i.a.name : i.b.name;
    return {
      yardstick: [TEMPLATES.Y1(), y2],
      bottomLine: TEMPLATES.UNAVAILABLE({ names }),
      tradeoffs: [],
      mainDifference: [],
      footer: COMPARE_FOOTER,
    };
  }
  const yardstick: ReviewLine[] = [TEMPLATES.Y1(), y2];
  if (i.dollarMode === 'real') yardstick.push(deflatorLine(i));
  yardstick.push(i.parity.equal ? TEMPLATES.Y4_EQUAL() : TEMPLATES.Y4_DIFFER({ list: i.parity.differences.join('; ') }));
  const bottom = chooseBottomLine(i);
  return {
    yardstick,
    bottomLine: bottom.line,
    tradeoffs: tradeoffLines(i, bottom),
    mainDifference: mainDifferenceLines(i),
    footer: COMPARE_FOOTER,
  };
}

// ── deflator source label (D-W3-P9; branch-mirrors effectiveBaselineInflation) ──

export const DEFLATOR_LABELS = {
  scenario: "the active scenario's inflation lever",
  household: 'your household setting',      // canonical provenance literal
  settings: 'your Settings default',        // canonical provenance literal
  appDefault: 'app default 3%',             // canonical provenance literal
} as const;

export function resolveDeflatorSourceLabel(
  scenario: Scenario | null,
  household: Household | null,
  settings: AppSettings | null,
): string {
  if (scenario?.leverPayload?.inflation?.defaultRate != null) return DEFLATOR_LABELS.scenario;
  if (household?.inflationAssumption != null) return DEFLATOR_LABELS.household;
  if (settings?.defaultInflation != null) return DEFLATOR_LABELS.settings;
  return DEFLATOR_LABELS.appDefault;
}

// ── A/B pair resolution (D-W3-3 / D-W3-P3; a lens — never writes stores) ────

export interface ComparePairSelection { aId: number | null; bId: number | null }
export interface ResolvedComparePair { a: Scenario | null; b: Scenario | null }

export function resolveComparePair(
  scenarios: Scenario[],
  sel: ComparePairSelection,
  createdScenarioId: number | null,
): ResolvedComparePair {
  const byId = (id: number | null): Scenario | undefined =>
    id == null ? undefined : scenarios.find((s) => s.id === id);
  const baseline =
    scenarios.find((s) => s.isBaseline)
    ?? [...scenarios].sort((x, y) => x.sortOrder - y.sortOrder)[0]
    ?? null;
  const a = byId(sel.aId) ?? baseline;
  const nonA = scenarios.filter((s) => s.id !== a?.id);
  const selB = byId(sel.bId);
  const b =
    (selB != null && selB.id !== a?.id ? selB : undefined)
    ?? nonA.find((s) => s.id === createdScenarioId)
    ?? nonA.find((s) => s.isActive && !s.isBaseline)
    ?? [...nonA].filter((s) => !s.isBaseline).sort((x, y) => y.sortOrder - x.sortOrder)[0]
    ?? nonA[0]
    ?? null;
  return { a: a ?? null, b };
}
