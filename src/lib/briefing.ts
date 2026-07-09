/**
 * "The Ledger" briefing — Wave 13 / design Direction 1 (spec:
 * docs/superpowers/plans/2026-07-09-design-directions-spec.md).
 *
 * Everything here is PURE and deterministic: the Dashboard injects today's
 * date, the stored visit stamps, and the already-derived signals; this module
 * owns the ranking, the materiality floors, and the vetted copy templates.
 * Calm-ethos guardrails are CODE, not convention: positive/steady framing
 * leads, a market dip is tone 'neutral' (never a red 'negative'), nothing
 * below the floors makes a row, and the concentration note keeps the spec's
 * "Note — not a warning." wording verbatim.
 */

import { deltaPctOrNull } from '@/lib/asset-value-chart';

// ---------------------------------------------------------------------------
// Visit stamps (persisted as app_settings.last_visit_date /
// .briefing_baseline_date — migration 0050)
// ---------------------------------------------------------------------------

export interface VisitStamps {
  lastVisitDate: string | null;
  briefingBaselineDate: string | null;
}

export type BriefingMode = 'last-visit' | 'last-month';

export interface VisitRoll {
  /** What app_settings should hold after this open. */
  stamps: VisitStamps;
  /** True on the first open of a new day — the caller persists exactly then. */
  changed: boolean;
  /** The day the briefing measures from, or null → use endOfLastMonthIso. */
  baselineIso: string | null;
  mode: BriefingMode;
}

/**
 * Roll the visit stamps for an app open on `todayIso` (local calendar day).
 * First open of a new day: baseline ← previous visit day, stamp ← today.
 * Same-day re-open: nothing moves, so the baseline is stable all day.
 * A baseline that isn't strictly in the past (first-ever open, day 2 of app
 * life before any baseline exists, or a backwards clock) falls back to
 * 'last-month' — the briefing must never measure today against today/future.
 */
export function rollVisitStamps(stored: VisitStamps, todayIso: string): VisitRoll {
  const isNewDay = stored.lastVisitDate === null || stored.lastVisitDate < todayIso;
  // Skew guard: a stored baseline at/after today was written by a future
  // clock (or the file is corrupt). Distrust the whole stamp pair for today's
  // briefing — never measure today against today/the future — and null the
  // persisted baseline so every re-open today lands on the same fallback.
  const skewed =
    stored.briefingBaselineDate !== null && stored.briefingBaselineDate >= todayIso;
  const baseline = skewed
    ? null
    : isNewDay
      ? stored.lastVisitDate
      : stored.briefingBaselineDate;
  const stamps: VisitStamps = isNewDay
    ? { lastVisitDate: todayIso, briefingBaselineDate: baseline }
    : skewed
      ? { lastVisitDate: stored.lastVisitDate, briefingBaselineDate: null }
      : stored;
  const changed = isNewDay || skewed;
  if (baseline === null || baseline >= todayIso) {
    return { stamps, changed, baselineIso: null, mode: 'last-month' };
  }
  return { stamps, changed, baselineIso: baseline, mode: 'last-visit' };
}

/**
 * Last CALENDAR day of the month before `today` — the fallback baseline.
 * Month-close is where snapshot history reliably exists (the Monthly ritual
 * confirms balances at the last business day of the month, which is always
 * on-or-before this date), unlike a rolling minus-one-month date which can
 * land in a history gap. Local getters, matching lastMonthYyyymm's style.
 */
export function endOfLastMonthIso(today: Date): string {
  const d = new Date(today.getFullYear(), today.getMonth(), 0); // day 0 = prev month's last day
  const y = d.getFullYear().toString().padStart(4, '0');
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MONTH_NAME_FMT = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });

/** "2026-06" → "June". */
export function monthName(yyyymm: string): string {
  return MONTH_NAME_FMT.format(new Date(`${yyyymm}-01T00:00:00Z`));
}

/** Card heading: the spec's hero title, or the honest month fallback. */
export function briefingHeading(mode: BriefingMode, lastMonthYyyymm: string): string {
  return mode === 'last-visit' ? 'Since your last visit' : `Since ${monthName(lastMonthYyyymm)}`;
}

// ---------------------------------------------------------------------------
// The ranked feed
// ---------------------------------------------------------------------------

/** Materiality floors (Decisions ledger #1). */
export const NET_WORTH_FLOOR_ABS = 500;
export const NET_WORTH_FLOOR_PCT = 0.005;
/**
 * Strictly-greater-than, mirroring computeConcentration's PER_TICKER_SOFT
 * (> 0.15) EXACTLY — the briefing must never "note" an exposure the
 * concentration system itself considers unremarkable.
 */
export const CONCENTRATION_NOTE_FLOOR = 0.15;
export const MAX_BRIEFING_ROWS = 4;

export type BriefingTone = 'positive' | 'note' | 'neutral' | 'action';

export interface BriefingRowPart {
  text: string;
  /** Rendered font-medium tabular-nums (the "small inline number"). */
  emphasis?: boolean;
}

export interface BriefingRow {
  id: string;
  parts: BriefingRowPart[];
  tone: BriefingTone;
  /** Intra-tone-class rank only — units differ across sources by design. */
  materiality: number;
  href: string;
  /** Chevron affordance label (visible on hover targets / aria). */
  linkLabel: string;
  /** True → BriefingCard appends "· Household" under an active person view. */
  householdScoped: boolean;
}

export interface BriefingInput {
  /** As-of values from netWorthAsOfFactory — already view-scoped by the caller. */
  netWorth: { current: number | null; baseline: number | null };
  /** Top non-Misc effective exposure (topEffectiveExposures(perTicker, 1)[0]). */
  concentration: { ticker: string; pctOfPortfolio: number } | null;
  /** From summarizeSpending over the view-scoped transactions. */
  spending: { currentMonthTotal: number; previousMonthTotal: number };
  monthly: {
    pending: boolean;
    /** lastMonthYyyymm(today) — the month being closed. */
    monthToClose: string;
    /** Accounts still lacking a USER_CONFIRMED/MANUAL snapshot for that month. */
    balancesToConfirm: number;
    /** Active loans (currentBalance > 0) — candidates, see caveat in buildBriefing. */
    loanPaymentsToRecord: number;
  };
  goals: ReadonlyArray<{ id: number; name: string; percentComplete: number }>;
  nextMove:
    | { kind: 'setup' }
    | { kind: 'disclosure' }
    | { kind: 'active'; title: string; href: string; ctaLabel?: string }
    | null;
  /** W10 S1: keep ?view= across navigation for view-respecting rows. */
  withView?: (path: string) => string;
}

export interface Briefing {
  rows: BriefingRow[];
  /** Non-null iff rows is empty — the honest, first-class calm outcome. */
  empty: { title: string; detail: string | null } | null;
}

/** Plain-text join, for tests, aria labels, and copy review. */
export function briefingRowText(row: BriefingRow): string {
  return row.parts.map((p) => p.text).join('');
}

const SIGNED_USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
  signDisplay: 'always',
});

const TONE_RANK: Record<BriefingTone, number> = { positive: 0, note: 1, neutral: 2, action: 3 };

function byToneThenMateriality(a: BriefingRow, b: BriefingRow): number {
  return TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.materiality - a.materiality;
}

/**
 * Build the ranked feed. Deterministic: same input, same rows, same order.
 * Informational rows fill the slots the (never-dropped) action rows leave;
 * the tone ranking encodes the spec's "positive/reassuring leads".
 */
export function buildBriefing(input: BriefingInput): Briefing {
  const withView = input.withView ?? ((p: string) => p);
  const informational: BriefingRow[] = [];
  const actions: BriefingRow[] = [];

  // --- Net worth (the "what changed" row; baseline per the visit roll) ------
  const { current, baseline } = input.netWorth;
  let netWorthSteady = false;
  if (current !== null && baseline !== null) {
    const delta = current - baseline;
    const floor = Math.max(NET_WORTH_FLOOR_ABS, NET_WORTH_FLOOR_PCT * Math.abs(baseline));
    if (Math.abs(delta) < floor) {
      netWorthSteady = true; // feeds the empty state's "holding steady"
    } else {
      // Shared percent-honesty guard: null on a ≤0 baseline and above the
      // ±999.9% cap — the dollar delta always shows, the percent is earned.
      const pct = deltaPctOrNull(delta, baseline);
      const pctSuffix = pct === null ? '' : ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
      informational.push({
        id: 'net-worth',
        parts: [
          { text: `Net worth is ${delta >= 0 ? 'up' : 'down'} ` },
          { text: `${SIGNED_USD.format(delta)}${pctSuffix}`, emphasis: true },
          { text: '.' },
        ],
        // Calm ethos (hard): a normal market dip is information, not alarm —
        // tone 'neutral', never a red 'negative'.
        tone: delta >= 0 ? 'positive' : 'neutral',
        materiality: Math.abs(delta),
        href: withView('/net-worth'),
        linkLabel: 'See net worth',
        householdScoped: false,
      });
    }
  }

  // --- Goal reached (at most one; a standing milestone, ranked below fresh
  // money moves via materiality 0) ------------------------------------------
  const reached = input.goals.find((g) => g.percentComplete >= 1);
  if (reached) {
    informational.push({
      id: `goal-reached-${reached.id}`,
      parts: [
        { text: "You've reached your " },
        { text: reached.name, emphasis: true },
        { text: ' goal.' },
      ],
      tone: 'positive',
      materiality: 0,
      href: withView('/goals'),
      linkLabel: 'See goals',
      householdScoped: false,
    });
  }

  // --- Concentration (protected-view honesty: ≤1 click to the breakdown) ---
  if (input.concentration && input.concentration.pctOfPortfolio > CONCENTRATION_NOTE_FLOOR) {
    const pct = (input.concentration.pctOfPortfolio * 100).toFixed(1);
    informational.push({
      id: 'concentration',
      parts: [
        // Spec copy VERBATIM (Direction 1 feed-row example) — do not reword.
        { text: `${input.concentration.ticker} is ${pct}% of your effective exposure`, emphasis: true },
        { text: '. Note — not a warning.' },
      ],
      tone: 'note',
      materiality: input.concentration.pctOfPortfolio,
      href: '/investments#concentration',
      linkLabel: 'See breakdown',
      householdScoped: true, // risk exposure is a household concept (2026-07 W1 decision)
    });
  }

  // --- Spending absence (neutral; only when they actually track spending) --
  if (input.spending.currentMonthTotal === 0 && input.spending.previousMonthTotal > 0) {
    informational.push({
      id: 'spending-missing',
      parts: [{ text: "This month's spending isn't in yet." }],
      tone: 'neutral',
      materiality: 0,
      href: withView('/spending'),
      linkLabel: 'Open spending',
      householdScoped: false,
    });
  }

  // --- Monthly cadence (the Statement direction's band as a ranked row) ----
  if (input.monthly.pending) {
    const n = input.monthly.balancesToConfirm;
    const m = input.monthly.loanPaymentsToRecord;
    const month = monthName(input.monthly.monthToClose);
    // Honesty caveat on m: it counts ACTIVE loans (candidates for a payment
    // this cycle), not net of payments already recorded — that reconciliation
    // needs the per-loan repo the Monthly page owns. The row only shows while
    // the ritual is pending, and /monthly is the ground truth one click away.
    const clauses = [
      n > 0 ? `confirm ${n} balance${n === 1 ? '' : 's'}` : null,
      m > 0 ? `record ${m} loan payment${m === 1 ? '' : 's'}` : null,
    ].filter((c): c is string => c !== null);
    const text = clauses.length > 0
      ? `Close ${month} — ${clauses.join(', ')}.`
      : `Close ${month} — review this month's check-in.`;
    actions.push({
      id: 'monthly-close',
      parts: [{ text }],
      tone: 'action',
      materiality: 100, // close the books before the next optimization
      href: '/monthly',
      linkLabel: 'Open monthly check-in',
      householdScoped: false, // pending counts are view-scoped by the caller
    });
  }

  // --- Next move (NextMoveCard demoted into the feed; phrase kept verbatim
  // per W7-Legal R-LWI-3: a heuristic suggestion, not a recommendation) -----
  if (input.nextMove) {
    const nm = input.nextMove;
    const spec =
      nm.kind === 'setup'
        ? { text: 'Suggested next step: finish setting up.', href: '/setup', linkLabel: 'Continue setup' }
        : nm.kind === 'disclosure'
          ? { text: 'Suggested next step: set up your roadmap.', href: '/roadmap', linkLabel: 'Open roadmap' }
          : { text: `Suggested next step: ${nm.title}.`, href: nm.href, linkLabel: nm.ctaLabel ?? 'Open roadmap' };
    actions.push({
      id: 'next-move',
      parts: [{ text: spec.text }],
      tone: 'action',
      materiality: 50,
      href: spec.href,
      linkLabel: spec.linkLabel,
      householdScoped: true, // the roadmap evaluates the whole household
    });
  }

  // --- Rank + cap -----------------------------------------------------------
  const sortedInfo = [...informational].sort(byToneThenMateriality);
  const sortedActions = [...actions].sort(byToneThenMateriality);
  const infoBudget = Math.max(0, MAX_BRIEFING_ROWS - sortedActions.length);
  const rows = [...sortedInfo.slice(0, infoBudget), ...sortedActions];

  if (rows.length === 0) {
    return {
      rows,
      // The honest, reassuring outcome — a first-class state, not a failure.
      // "Holding steady" is only claimed when we actually measured a
      // below-floor delta; with no history we claim nothing.
      empty: {
        title: 'Nothing needs your attention.',
        detail: netWorthSteady ? 'Net worth is holding steady.' : null,
      },
    };
  }
  return { rows, empty: null };
}
