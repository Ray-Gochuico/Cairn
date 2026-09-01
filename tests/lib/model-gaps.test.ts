import { describe, it, expect } from 'vitest';
import { emptyLeverPayload } from '@/lib/scenarios';
import { buildModelGaps, type ModelGapsInput } from '@/lib/model-gaps';
import { makeAccount, makeHousehold, makePerson } from '../factories';
import { AccountType, ContributionSource, SnapshotSource } from '@/types/enums';
import type { AccountSnapshot, AppSettings, Contribution } from '@/types/schema';

// Fixture notes (Step 0 recorded the SHIPPED shapes):
// - Contribution's date field is `date`, NOT `contributionDate`.
// - buildScenarioDefaults reads {accountId, snapshotDate, totalValue};
//   monthlyInputPendingFor additionally reads `source`, and clears an account
//   only for a USER_CONFIRMED/MANUAL row dated in the PREVIOUS month — so the
//   settled snapshot is dated 2026-07-31, not TODAY.
// - pickModerateEntry matches the literal label 'Moderate'.
const TODAY = '2026-08-25';
const P = () => emptyLeverPayload();

const fullHousehold = makeHousehold({
  monthlyExpenseBaseline: 6_000, withdrawalRate: 0.04, inflationAssumption: 0.03,
  growthScenarios: [{ label: 'Moderate', rate: 0.06 }],
});

const brokerage = makeAccount({ id: 3, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' });

const confirmedSnapshot: AccountSnapshot = {
  id: 1, accountId: 3, snapshotDate: '2026-07-31', totalValue: 50_000,
  source: SnapshotSource.USER_CONFIRMED,
};
const recentContribution: Contribution = {
  id: 1, accountId: 3, personId: null, date: '2026-06-15', amount: 500,
  source: ContributionSource.MANUAL,
};
const SETTLED_SETTINGS = { defaultDrawdownTaxRate: 0.15 } as AppSettings;

/** A household with every projection input present → ZERO rows (D-W3-13). */
export const settledInput = (over: Partial<ModelGapsInput> = {}): ModelGapsInput => ({
  household: fullHousehold,
  settings: SETTLED_SETTINGS,
  persons: [makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 120_000 })],
  accounts: [brokerage],
  snapshots: [confirmedSnapshot],
  contributions: [recentContribution],
  roadmapHasUnanswered: false,
  sides: [
    { name: 'Baseline', payload: P() },
    { name: 'Aggressive payoff', payload: P() },
  ],
  todayIso: TODAY,
  ...over,
});

describe('buildModelGaps — absence is the calm outcome', () => {
  it('fully-set household → zero rows (the card will not render)', () => {
    expect(buildModelGaps(settledInput()).rows).toEqual([]);
  });

  it('G1: zero expense baseline', () => {
    const rows = buildModelGaps(settledInput({ household: makeHousehold({ ...fullHousehold, monthlyExpenseBaseline: 0 }) })).rows;
    const g1 = rows.find((r) => r.id === 'G1');
    expect(g1?.text).toBe("No monthly expense baseline — FI dates can't be computed, so they aren't shown.");
    expect(g1?.cta).toEqual({ label: 'Open Household →', to: '/inputs/household' });
  });

  it('G1 stays silent when there is no household at all (the page owns that moment)', () => {
    const rows = buildModelGaps(settledInput({ household: null })).rows;
    expect(rows.find((r) => r.id === 'G1')).toBeUndefined();
  });

  it('G2 + G3 co-fire with no snapshots: portfolio $0 AND last month unconfirmed', () => {
    const rows = buildModelGaps(settledInput({ snapshots: [] })).rows;
    expect(rows.find((r) => r.id === 'G2')?.text)
      .toBe('No account snapshots yet — the portfolio starts at $0 in these projections.');
    expect(rows.find((r) => r.id === 'G2')?.cta).toEqual({ label: 'Open Accounts →', to: '/investments?manage=accounts' });
    expect(rows.find((r) => r.id === 'G3')?.text)
      .toBe("Last month's balances aren't confirmed — lines start from the latest figures you've confirmed.");
    expect(rows.find((r) => r.id === 'G3')?.cta).toEqual({ label: 'Open monthly check-in →', to: '/monthly' });
  });

  it('G3 alone: a snapshot exists but last month was never confirmed', () => {
    const auto: AccountSnapshot = { ...confirmedSnapshot, source: SnapshotSource.AUTO_DERIVED };
    const rows = buildModelGaps(settledInput({ snapshots: [auto] })).rows;
    expect(rows.find((r) => r.id === 'G2')).toBeUndefined();  // portfolio is non-zero
    expect(rows.find((r) => r.id === 'G3')?.text)
      .toBe("Last month's balances aren't confirmed — lines start from the latest figures you've confirmed.");
  });

  it('G4: no contributions in the trailing 12 months', () => {
    const rows = buildModelGaps(settledInput({ contributions: [] })).rows;
    expect(rows.find((r) => r.id === 'G4')?.text)
      .toBe('No contributions in the last 12 months — ongoing contributions enter these prefills as $0.');
    expect(rows.find((r) => r.id === 'G4')?.cta).toEqual({ label: 'Open Contributions →', to: '/investments?manage=contributions' });
  });

  it('G4: a contribution older than the trailing window still fires the row', () => {
    const stale: Contribution = { ...recentContribution, date: '2024-06-15' };
    expect(buildModelGaps(settledInput({ contributions: [stale] })).rows.find((r) => r.id === 'G4')?.text)
      .toBe('No contributions in the last 12 months — ongoing contributions enter these prefills as $0.');
  });

  it('G5 + G6: growth and withdrawal app-defaults surface as named facts', () => {
    const bare = makeHousehold({ ...fullHousehold, growthScenarios: [], withdrawalRate: 0 });
    const rows = buildModelGaps(settledInput({ household: bare })).rows;
    expect(rows.find((r) => r.id === 'G5')?.text).toBe('Growth rate: app default 6% — no growth scenarios set.');
    expect(rows.find((r) => r.id === 'G5')?.cta).toEqual({ label: 'Open Household →', to: '/inputs/household' });
    expect(rows.find((r) => r.id === 'G6')?.text).toBe('Withdrawal rate: app default 4% — not set in Inputs.');
    expect(rows.find((r) => r.id === 'G6')?.cta).toEqual({ label: 'Open Household →', to: '/inputs/household' });
  });

  it('G8: fires per no-income person; hourly workers are NOT flagged (D-W3-P5)', () => {
    const rows = buildModelGaps(settledInput({
      persons: [
        makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 0, hourlyRate: 45 }),   // hourly — silent
        makePerson({ id: 2, name: 'Sam', annualSalaryPretax: 0, hourlyRate: null }),  // no income — row
      ],
    })).rows;
    const g8 = rows.filter((r) => r.id.startsWith('G8'));
    expect(g8.map((r) => r.text)).toEqual(['Sam has no salary entered — the projection carries no income for them.']);
    expect(g8[0].cta).toEqual({ label: 'Open Persons →', to: '/inputs/persons' });
    expect(g8[0].id).toBe('G8:2');
  });

  it('G8: two no-income persons render in person-id order', () => {
    const rows = buildModelGaps(settledInput({
      persons: [
        makePerson({ id: 2, name: 'Sam', annualSalaryPretax: 0 }),
        makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 0 }),
      ],
    })).rows;
    expect(rows.filter((r) => r.id.startsWith('G8')).map((r) => r.id)).toEqual(['G8:1', 'G8:2']);
  });

  it('G9: aggregated roadmap row', () => {
    const rows = buildModelGaps(settledInput({ roadmapHasUnanswered: true })).rows;
    expect(rows.find((r) => r.id === 'G9')?.text)
      .toBe("The roadmap has questions you haven't answered — its checklist and frameworks assume less until you do.");
    expect(rows.find((r) => r.id === 'G9')?.cta).toEqual({ label: 'Open Roadmap →', to: '/roadmap' });
  });

  it('G10: engine-true untaxed-sequential row, named when one side qualifies', () => {
    const seq = { ...P(), withdrawalStrategy: 'sequential' as const };
    const both = buildModelGaps(settledInput({
      settings: null,
      sides: [{ name: 'Baseline', payload: seq }, { name: 'Aggressive payoff', payload: seq }],
    })).rows;
    expect(both.find((r) => r.id === 'G10')?.text)
      .toBe("Drawdown tax rate isn't set — sequential withdrawals are modeled untaxed.");
    expect(both.find((r) => r.id === 'G10')?.cta).toEqual({ label: 'Open Settings →', to: '/settings' });
    const one = buildModelGaps(settledInput({
      settings: null,
      sides: [{ name: 'Baseline', payload: P() }, { name: 'Aggressive payoff', payload: seq }],
    })).rows;
    expect(one.find((r) => r.id === 'G10')?.text)
      .toBe("Drawdown tax rate isn't set — Aggressive payoff's sequential withdrawals are modeled untaxed.");
    // Payload rate > 0 means the tax IS modeled → silent (engine truth):
    const taxed = buildModelGaps(settledInput({
      settings: null,
      sides: [{ name: 'Baseline', payload: { ...seq, effectiveDrawdownTaxRate: 0.2 } }, { name: 'B2', payload: { ...seq, effectiveDrawdownTaxRate: 0.2 } }],
    })).rows;
    expect(taxed.find((r) => r.id === 'G10')).toBeUndefined();
    // Settings rate present → silent:
    expect(buildModelGaps(settledInput({
      sides: [{ name: 'Baseline', payload: seq }, { name: 'B2', payload: seq }],
    })).rows.find((r) => r.id === 'G10')).toBeUndefined();
    // No sequential side at all → silent even with settings unset:
    expect(buildModelGaps(settledInput({ settings: null })).rows.find((r) => r.id === 'G10')).toBeUndefined();
  });

  it('G10: a single-scenario page names nothing it cannot name', () => {
    const seq = { ...P(), withdrawalStrategy: 'sequential' as const };
    const rows = buildModelGaps(settledInput({ settings: null, sides: [{ name: 'Baseline', payload: seq }] })).rows;
    expect(rows.find((r) => r.id === 'G10')?.text)
      .toBe("Drawdown tax rate isn't set — sequential withdrawals are modeled untaxed.");
    expect(buildModelGaps(settledInput({ settings: null, sides: [] })).rows.find((r) => r.id === 'G10')).toBeUndefined();
  });

  it('row order is the contract order (G1 → G10)', () => {
    const rows = buildModelGaps(settledInput({
      household: makeHousehold({ ...fullHousehold, monthlyExpenseBaseline: 0, growthScenarios: [], withdrawalRate: 0 }),
      snapshots: [], contributions: [], roadmapHasUnanswered: true, settings: null,
      sides: [{ name: 'Baseline', payload: { ...P(), withdrawalStrategy: 'sequential' as const } }, { name: 'B2', payload: { ...P(), withdrawalStrategy: 'sequential' as const } }],
    })).rows;
    expect(rows.map((r) => r.id)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G9', 'G10']);
  });

  it('CI-26b: canonical provenance fragments appear verbatim (case-insensitive at sentence start)', () => {
    const rows = buildModelGaps(settledInput({
      snapshots: [], contributions: [],
      household: makeHousehold({ ...fullHousehold, growthScenarios: [], withdrawalRate: 0 }),
    })).rows;
    const texts = rows.map((r) => r.text.toLowerCase()).join('\n');
    for (const canonical of ['no account snapshots yet', 'no contributions in the last 12 months', 'app default 6%', 'app default 4%']) {
      expect(texts).toContain(canonical);
    }
  });

  it('PROPERTY: byte-identical output for independently constructed equal inputs', () => {
    expect(JSON.stringify(buildModelGaps(settledInput({ snapshots: [] }))))
      .toBe(JSON.stringify(buildModelGaps(settledInput({ snapshots: [] }))));
  });

  it('no advice lexeme, no reserved phrase in any row', () => {
    const rows = buildModelGaps(settledInput({
      household: makeHousehold({ ...fullHousehold, monthlyExpenseBaseline: 0, growthScenarios: [], withdrawalRate: 0 }),
      snapshots: [], contributions: [], roadmapHasUnanswered: true, settings: null,
      persons: [makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 0 })],
      sides: [{ name: 'Baseline', payload: { ...P(), withdrawalStrategy: 'sequential' as const } }, { name: 'B2', payload: { ...P(), withdrawalStrategy: 'sequential' as const } }],
    })).rows;
    expect(rows.length).toBeGreaterThanOrEqual(8);
    const ADVICE = /\b(should|recommend|recommendation|consider|suggest|suggested|ought|advise|advice|winner|act now)\b/i;
    for (const r of rows) {
      expect(r.text).not.toMatch(ADVICE);
      expect(r.text).not.toContain('Suggested next step');
      expect(r.text).not.toContain('Note — not a warning.');
      expect(r.text).not.toContain('!');
      // The spec's no-percentages rule targets completeness meters, not the
      // canonical assumption strings — G5/G6 embed 'app default 6%' /
      // 'app default 4%' VERBATIM per CI-26b, so they are scoped out.
      if (r.id !== 'G5' && r.id !== 'G6') expect(r.text).not.toContain('%');
    }
  });

  it('golden byte pins (D-W3-P14): the all-rows fixture and the empty fixture', () => {
    const all = buildModelGaps(settledInput({
      household: makeHousehold({ ...fullHousehold, monthlyExpenseBaseline: 0, growthScenarios: [], withdrawalRate: 0 }),
      snapshots: [], contributions: [], roadmapHasUnanswered: true, settings: null,
      persons: [makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 0 })],
      sides: [{ name: 'Baseline', payload: { ...P(), withdrawalStrategy: 'sequential' as const } }, { name: 'B2', payload: { ...P(), withdrawalStrategy: 'sequential' as const } }],
    }));
    expect(JSON.stringify(all)).toBe(GOLDEN_ALL_ROWS);
    expect(JSON.stringify(buildModelGaps(settledInput()))).toBe('{"rows":[]}');
  });
});

// ── Golden byte pin ─────────────────────────────────────────────────────────
// Materialized from a reviewed first run (D-W3-P14): printed once, checked
// row by row against the CR-G contract table, then locked.
const GOLDEN_ALL_ROWS = '{"rows":[{"id":"G1","text":"No monthly expense baseline — FI dates can\'t be computed, so they aren\'t shown.","cta":{"label":"Open Household →","to":"/inputs/household"}},{"id":"G2","text":"No account snapshots yet — the portfolio starts at $0 in these projections.","cta":{"label":"Open Accounts →","to":"/investments?manage=accounts"}},{"id":"G3","text":"Last month\'s balances aren\'t confirmed — lines start from the latest figures you\'ve confirmed.","cta":{"label":"Open monthly check-in →","to":"/monthly"}},{"id":"G4","text":"No contributions in the last 12 months — ongoing contributions enter these prefills as $0.","cta":{"label":"Open Contributions →","to":"/investments?manage=contributions"}},{"id":"G5","text":"Growth rate: app default 6% — no growth scenarios set.","cta":{"label":"Open Household →","to":"/inputs/household"}},{"id":"G6","text":"Withdrawal rate: app default 4% — not set in Inputs.","cta":{"label":"Open Household →","to":"/inputs/household"}},{"id":"G8:1","text":"Alex has no salary entered — the projection carries no income for them.","cta":{"label":"Open Persons →","to":"/inputs/persons"}},{"id":"G9","text":"The roadmap has questions you haven\'t answered — its checklist and frameworks assume less until you do.","cta":{"label":"Open Roadmap →","to":"/roadmap"}},{"id":"G10","text":"Drawdown tax rate isn\'t set — sequential withdrawals are modeled untaxed.","cta":{"label":"Open Settings →","to":"/settings"}}]}';
