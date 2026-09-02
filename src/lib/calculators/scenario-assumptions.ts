import type { Account, AppSettings, Household } from '@/types/schema';
import { fiEligiblePortfolioValue } from '@/lib/fi-portfolio';
import { pickModerateEntry } from '@/lib/growth-scenario';
import { effectiveSwr } from '@/lib/scenarios/effective-swr';
import { effectiveBaselineInflation } from '@/lib/scenarios/effective-inflation';
import { isExploreMode, prefKey } from '@/lib/explore-mode';

/**
 * Wave 16 "Basecamp spine": THE shared scenario-assumptions module.
 *
 * Before this existed, five assumptions were duplicated across per-card
 * sessionStorage silos with three unit conventions (FI stored SWR as 4,
 * CoastFI as 0.04; FI expenses monthly, CoastFI annual) — the calculators
 * page could show three different "portfolios" at once. This module owns:
 *   - the ONE typed shape (display units: dollars + percent-as-number),
 *   - prefills from the CANONICAL resolvers only (fiEligiblePortfolioValue,
 *     rolling-12-month contributions, household.monthlyExpenseBaseline,
 *     effectiveSwr, effectiveBaselineInflation, pickModerateEntry),
 *   - the ONE percent→fraction boundary (toEngineAssumptions — no card may
 *     divide a shared field by 100 or multiply expenses by 12 itself),
 *   - session persistence under `calc-scenario:shared`, with the same
 *     override/reset semantics as useCalculatorState (overrides win over
 *     recomputed defaults; empty overrides remove the key),
 *   - a one-shot migration of the three legacy projection-card silos.
 *
 * Framework-free and pure — the React binding lives in
 * use-scenario-assumptions.ts.
 */

export const SCENARIO_STORAGE_KEY = 'calc-scenario:shared';

export interface ScenarioAssumptions {
  portfolio: number;          // FI-eligible current portfolio ($)
  annualContribution: number; // rolling-12-month contributions ($/yr)
  monthlyExpenses: number;    // household monthly expense baseline ($/mo)
  returnPct: number;          // annual return, percent-as-number (6 = 6%)
  swrPct: number;             // safe withdrawal rate, percent-as-number (4 = 4%)
  inflationPct: number;       // annual inflation, percent-as-number (3 = 3%)
}
export type ScenarioField = keyof ScenarioAssumptions;
export const SCENARIO_FIELDS: readonly ScenarioField[] = [
  'portfolio',
  'annualContribution',
  'monthlyExpenses',
  'returnPct',
  'swrPct',
  'inflationPct',
] as const;

export interface EngineAssumptions {
  portfolio: number;
  annualContribution: number;
  monthlyContribution: number; // annualContribution / 12 (Compound's PMT)
  monthlyExpenses: number;
  annualExpenses: number;      // monthlyExpenses * 12 (FI/CoastFI target numerator)
  returnRate: number;          // fraction
  swr: number;                 // fraction
  inflation: number;           // fraction
}

/**
 * Fraction → percent-as-number without float artifacts (0.07*100 is
 * 7.000000000000001 in IEEE754). Same 1e8 rounding the CoastFI card used
 * for its ÷100 display round-trip — now the one shared copy.
 */
export function pctFromFraction(fraction: number): number {
  return Math.round(fraction * 100 * 1e8) / 1e8;
}

/**
 * THE percent/fraction conversion boundary (D1). Everything upstream is
 * display units; everything downstream (financialIndependenceSeries, coastFi,
 * compoundInterestSeries, buildProjectionChartData, backtest seeding) is
 * fractions/derived units. Locked by a historical-anchor test — the repo's
 * nominal-on-real bug class is caught by anchors, not unit tests.
 */
export function toEngineAssumptions(v: ScenarioAssumptions): EngineAssumptions {
  return {
    portfolio: v.portfolio,
    annualContribution: v.annualContribution,
    monthlyContribution: v.annualContribution / 12,
    monthlyExpenses: v.monthlyExpenses,
    annualExpenses: v.monthlyExpenses * 12,
    returnRate: v.returnPct / 100,
    swr: v.swrPct / 100,
    inflation: v.inflationPct / 100,
  };
}

export interface ScenarioDefaultsInput {
  household: Household | null;
  settings: AppSettings | null;
  accounts: ReadonlyArray<Account>;
  snapshots: ReadonlyArray<{ accountId: number; snapshotDate: string; totalValue: number }>;
  /** personId rides along for Wave-B person scoping (Contribution.personId). */
  contributions: ReadonlyArray<{ accountId: number; date: string; amount: number; personId?: number | null }>;
  /** Injectable for tests; defaults to today. */
  todayIso?: string;
  /**
   * Wave B: person scope — omit/null for household (pre-Wave-B behavior).
   * Migration 0051: `monthlyExpenseBaseline` is the scoped person's durable
   * monthly expense figure (persons.monthly_expense_baseline). Non-null
   * replaces the even-split default; null/omitted keeps the labeled split.
   */
  scope?: { personId: number; personName: string; monthlyExpenseBaseline?: number | null } | null;
}

/** Wave B (D-B1/D-B4): what a person scope EXCLUDED — surfaced, never silent. */
export interface ScopeExclusions {
  /** Latest-snapshot sum over FI-eligible JOINT (null-owner) accounts. */
  jointPortfolio: number;
  /** Rolling-12-month contributions with NO person attribution. */
  unattributedContribution: number;
}

export interface ScenarioDefaultsResult {
  defaults: ScenarioAssumptions;
  provenance: Record<ScenarioField, string>;
  /** null in household scope. */
  scopeExclusions: ScopeExclusions | null;
}

/**
 * Rolling 12-month contribution total — the FI card's annual-PMT prefill,
 * extracted (it was inline in FinancialIndependenceCard). ISO string compare
 * is chronological for YYYY-MM-DD.
 */
export function rolling12MonthContribution(
  contributions: ReadonlyArray<{ date: string; amount: number }>,
  todayIso: string,
): number {
  const oneYearAgo = new Date(`${todayIso}T12:00:00Z`);
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
  const isoYearAgo = oneYearAgo.toISOString().slice(0, 10);
  return contributions.filter((c) => c.date >= isoYearAgo).reduce((sum, c) => sum + c.amount, 0);
}

/**
 * Prefills from the canonical resolvers ONLY, with an honest provenance label
 * per field (D8). The provenance is derived from the SAME inputs the resolver
 * reads and is parity-tested against the resolver output — the label can
 * never disagree with the number.
 */
export function buildScenarioDefaults(input: ScenarioDefaultsInput): ScenarioDefaultsResult {
  const todayIso = input.todayIso ?? new Date().toISOString().slice(0, 10);
  const { household, settings } = input;

  const scope = input.scope ?? null;
  // D-B13: owner filtering composes by pre-filtering the account/contribution
  // lists — fiEligiblePortfolioValue and rolling12MonthContribution are NOT
  // modified. Same semantics as filterByOwnerPersonId/personId ('joint' rows
  // are the ownerPersonId == null ones).
  const scopedAccounts =
    scope == null ? input.accounts : input.accounts.filter((a) => a.ownerPersonId === scope.personId);
  const scopedContributions =
    scope == null ? input.contributions : input.contributions.filter((c) => c.personId === scope.personId);

  const portfolio = fiEligiblePortfolioValue(scopedAccounts, input.snapshots, todayIso);
  const annualContribution = rolling12MonthContribution(scopedContributions, todayIso);
  // D-B5 + migration 0051: person scope prefers the person's own durable
  // baseline when SET (non-null — an explicit $0 counts as set); otherwise
  // the labeled even split of the household baseline. Household scope never
  // reads the per-person figure.
  const baseline = household?.monthlyExpenseBaseline ?? 0;
  const personBaseline = scope?.monthlyExpenseBaseline ?? null;
  const monthlyExpenses =
    scope == null ? baseline : personBaseline != null ? personBaseline : baseline / 2;

  const scopeExclusions: ScopeExclusions | null =
    scope == null
      ? null
      : {
          jointPortfolio: fiEligiblePortfolioValue(
            input.accounts.filter((a) => a.ownerPersonId == null),
            input.snapshots,
            todayIso,
          ),
          unattributedContribution: rolling12MonthContribution(
            input.contributions.filter((c) => c.personId == null),
            todayIso,
          ),
        };

  // Defensive `?? []`: a partial household object (store mocks, malformed
  // rows) without growthScenarios must fall back to the app default, never
  // crash the whole calculators page.
  const moderate = household ? pickModerateEntry(household.growthScenarios ?? []) : undefined;
  const returnPct = moderate ? pctFromFraction(moderate.rate) : 6;

  // Canonical chains (no active scenario on the calculators page → null).
  const swrPct = pctFromFraction(effectiveSwr(null, household));
  const inflationPct = pctFromFraction(effectiveBaselineInflation(null, household, settings));

  const provenance: Record<ScenarioField, string> = {
    portfolio:
      scope == null
        ? portfolio > 0
          ? 'from your account snapshots'
          : 'no account snapshots yet'
        : portfolio > 0
          ? `from ${scope.personName}'s account snapshots — joint accounts not included`
          : `no snapshots for ${scope.personName}'s accounts`,
    annualContribution:
      scope == null
        ? annualContribution > 0
          ? 'your last 12 months of contributions'
          : 'no contributions in the last 12 months'
        : annualContribution > 0
          ? `${scope.personName}'s contributions, last 12 months`
          : `no contributions attributed to ${scope.personName} in the last 12 months`,
    monthlyExpenses:
      // 0051: the durable per-person figure is labeled from Inputs even at $0
      // — 'not set in Inputs' would be dishonest for an explicitly set value.
      scope != null && personBaseline != null
        ? `from ${scope.personName}'s Inputs`
        : monthlyExpenses > 0
          ? scope == null
            ? 'your monthly expense baseline'
            : 'half your household baseline — even split'
          : 'not set in Inputs',
    returnPct: moderate ? `your ${moderate.label} growth scenario` : 'app default 6%',
    swrPct:
      household?.withdrawalRate != null && household.withdrawalRate > 0
        ? 'your household setting'
        : 'app default 4%',
    inflationPct:
      household?.inflationAssumption != null
        ? 'your household setting'
        : settings?.defaultInflation != null
          ? 'your Settings default'
          : 'app default 3%',
  };

  return {
    defaults: { portfolio, annualContribution, monthlyExpenses, returnPct, swrPct, inflationPct },
    provenance,
    scopeExclusions,
  };
}

// ── Persistence + one-shot legacy migration ─────────────────────────────────

const FIELD_SET = new Set<string>(SCENARIO_FIELDS);

function sanitize(raw: unknown): Partial<ScenarioAssumptions> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Partial<ScenarioAssumptions> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (FIELD_SET.has(k) && typeof v === 'number' && Number.isFinite(v)) {
      out[k as ScenarioField] = v;
    }
  }
  return out;
}

function readSiloRaw(key: string): Record<string, unknown> {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function finiteNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * One-shot migration (D7): lift any live shared-field overrides out of the
 * three legacy projection-card silos into the shared shape, converting units
 * at read time (the ONLY place legacy units are ever touched). Precedence
 * financial-independence > coast-fi > compound-interest, first-found wins per
 * field. Migrated keys are DELETED from each silo (locals like coast-fi's
 * yearsUntilRetirement survive), so the migration is naturally idempotent.
 */
function migrateLegacySilos(): Partial<ScenarioAssumptions> {
  // W4 review (MAJOR 1): this migration READS and then STRIPS the raw
  // `calc-state:` silos. Those are the REAL profile's keys while the
  // calculator silos are namespaced in explore, so running it from a sample
  // session would consume and delete the user's own overrides.
  if (isExploreMode()) return {};
  const out: Partial<ScenarioAssumptions> = {};
  const take = (field: ScenarioField, value: number | undefined) => {
    if (value !== undefined && !(field in out)) out[field] = value;
  };

  const fiKey = 'calc-state:financial-independence';
  const coastKey = 'calc-state:coast-fi';
  const compoundKey = 'calc-state:compound-interest';

  const fi = readSiloRaw(fiKey);
  take('portfolio', finiteNum(fi.currentPortfolio));
  take('annualContribution', finiteNum(fi.annualContribution));
  take('monthlyExpenses', finiteNum(fi.monthlyExpenses));
  take('swrPct', finiteNum(fi.withdrawalRatePct));

  const coast = readSiloRaw(coastKey);
  take('portfolio', finiteNum(coast.currentPortfolio));
  const coastAnnualExpenses = finiteNum(coast.annualExpenses);
  take('monthlyExpenses', coastAnnualExpenses === undefined ? undefined : coastAnnualExpenses / 12);
  const coastSwrFraction = finiteNum(coast.withdrawalRate);
  take('swrPct', coastSwrFraction === undefined ? undefined : pctFromFraction(coastSwrFraction));

  const compound = readSiloRaw(compoundKey);
  take('portfolio', finiteNum(compound.pv));
  const compoundPmt = finiteNum(compound.monthlyContribution);
  take('annualContribution', compoundPmt === undefined ? undefined : compoundPmt * 12);
  take('returnPct', finiteNum(compound.ratePercent));

  // Strip the migrated (shared) keys from each silo; keep genuinely-local ones.
  const strip = (key: string, raw: Record<string, unknown>, sharedKeys: string[]) => {
    if (Object.keys(raw).length === 0) return;
    const rest = Object.fromEntries(Object.entries(raw).filter(([k]) => !sharedKeys.includes(k)));
    try {
      if (Object.keys(rest).length === 0) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(rest));
    } catch {
      // sessionStorage unavailable — in-memory migration result still applies.
    }
  };
  strip(fiKey, fi, ['currentPortfolio', 'annualContribution', 'monthlyExpenses', 'withdrawalRatePct']);
  strip(coastKey, coast, ['currentPortfolio', 'annualExpenses', 'withdrawalRate']);
  strip(compoundKey, compound, ['pv', 'monthlyContribution', 'ratePercent']);

  return out;
}

/**
 * Read the shared overrides. When the shared key is ABSENT, runs the one-shot
 * legacy migration first (and persists its result iff non-empty, so the
 * silos — already stripped — are never re-read).
 */
export function readSharedOverrides(): Partial<ScenarioAssumptions> {
  try {
    const raw = sessionStorage.getItem(scenarioStorageKeyFor(null));
    if (raw !== null) return sanitize(JSON.parse(raw));
  } catch {
    return {};
  }
  const migrated = migrateLegacySilos();
  if (Object.keys(migrated).length > 0) {
    try {
      sessionStorage.setItem(scenarioStorageKeyFor(null), JSON.stringify(migrated));
    } catch {
      // sessionStorage unavailable — in-memory state still drives the UI.
    }
  }
  return migrated;
}

/** Same removal-when-empty contract as calculator-state.ts's writeOverrides. */
export function writeSharedOverrides(overrides: Partial<ScenarioAssumptions>): void {
  try {
    const key = scenarioStorageKeyFor(null);
    if (Object.keys(overrides).length === 0) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(overrides));
  } catch {
    // sessionStorage unavailable — in-memory state still drives the UI.
  }
}

/**
 * Wave B (D-B11): per-scope override silos. Household keeps the W16 shared
 * key — its sanitize + one-shot legacy-migration contract is UNTOUCHED (the
 * migration below runs only through readSharedOverrides). Person scopes get
 * sibling silos keyed by person id; same shape, same sanitize, same
 * empty-removes-key contract.
 */
export function scenarioStorageKeyFor(scopePersonId: number | null): string {
  // W4 review (MAJOR 1): person silos are keyed BY person id and hold numbers
  // derived from that profile — namespaced while exploring, reaped on exit.
  return prefKey(
    scopePersonId == null ? SCENARIO_STORAGE_KEY : `calc-scenario:p${scopePersonId}`,
  );
}

export function readOverridesFor(scopePersonId: number | null): Partial<ScenarioAssumptions> {
  if (scopePersonId == null) return readSharedOverrides();
  try {
    const raw = sessionStorage.getItem(scenarioStorageKeyFor(scopePersonId));
    return raw == null ? {} : sanitize(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeOverridesFor(
  scopePersonId: number | null,
  overrides: Partial<ScenarioAssumptions>,
): void {
  if (scopePersonId == null) {
    writeSharedOverrides(overrides);
    return;
  }
  const key = scenarioStorageKeyFor(scopePersonId);
  try {
    if (Object.keys(overrides).length === 0) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(overrides));
  } catch {
    // sessionStorage unavailable — in-memory state still drives the UI.
  }
}
