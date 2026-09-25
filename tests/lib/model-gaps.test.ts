import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { emptyLeverPayload } from '@/lib/scenarios';
import { buildModelGaps, type ModelGapsInput } from '@/lib/model-gaps';
import { makeAccount, makeHousehold, makePerson } from '../factories';
import { AccountType, ContributionSource, SnapshotSource } from '@/types/enums';
import type { AccountSnapshot, AppSettings, Contribution } from '@/types/schema';
import { ADVICE_LEXICON, RESERVED_PHRASES } from '../helpers/advice-lexicon';

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
  engineStartsAtZero: true,
  scenarioSpending: [],
  sides: [
    { name: 'Baseline', payload: P() },
    { name: 'Aggressive payoff', payload: P() },
  ],
  todayIso: TODAY,
  ...over,
});

// C2 (G11) fixtures — two facts the page reads off each visible scenario's OWN
// projection (milestones.ts projectionSpending): does any month spend something
// the scenario authored, and does any month spend anything at all?
const AT_ZERO = { scenarioId: 1, name: 'Baseline', authorsSpending: false, spendsAnything: false };
const AT_ZERO_RENT = { scenarioId: 1, name: 'Baseline', authorsSpending: false, spendsAnything: true };
const SET = { scenarioId: 2, name: 'Aggressive payoff', authorsSpending: true, spendsAnything: true };
const G11_NOTHING = (name: string) => `${name}'s expense base is $0 — the projection assumes nothing is spent, so no FI date is shown.`;
const G11_OBLIGATIONS = (name: string) => `${name}'s expense base is $0 — the projection counts only rent and vehicle leases as spending, so no FI date is shown.`;

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

  // Review MINOR 12: G3 states a FACT. isMonthlyInputPending layers a day-1
  // nudge and a 2..7 grace window on top of the underlying predicate; a panel
  // row that says "aren't confirmed" must read the predicate, not the nudge.
  it('G3 is SILENT on the 1st when last month WAS confirmed (the day-1 nudge is not a fact)', () => {
    const augConfirmed: AccountSnapshot = { ...confirmedSnapshot, snapshotDate: '2026-08-31' };
    const rows = buildModelGaps(settledInput({ todayIso: '2026-09-01', snapshots: [augConfirmed] })).rows;
    expect(rows.find((r) => r.id === 'G3')).toBeUndefined();
  });

  it('G3 still fires on the 1st when last month is genuinely unconfirmed', () => {
    const augAuto: AccountSnapshot = {
      ...confirmedSnapshot, snapshotDate: '2026-08-31', source: SnapshotSource.AUTO_DERIVED,
    };
    const rows = buildModelGaps(settledInput({ todayIso: '2026-09-01', snapshots: [augAuto] })).rows;
    expect(rows.find((r) => r.id === 'G3')?.text)
      .toBe("Last month's balances aren't confirmed — lines start from the latest figures you've confirmed.");
  });

  it('G3 fires inside the 2..7 grace window too — the row is a fact, not a nudge schedule', () => {
    const augAuto: AccountSnapshot = {
      ...confirmedSnapshot, snapshotDate: '2026-08-31', source: SnapshotSource.AUTO_DERIVED,
    };
    const rows = buildModelGaps(settledInput({ todayIso: '2026-09-03', snapshots: [augAuto] })).rows;
    expect(rows.find((r) => r.id === 'G3')).toBeDefined();
  });

  describe('the injected day is read TZ-invariantly (no UTC slip inside the lib)', () => {
    const ORIGINAL_TZ = process.env.TZ;
    beforeEach(() => { process.env.TZ = 'Pacific/Auckland'; });  // UTC+12/+13
    afterEach(() => {
      if (ORIGINAL_TZ === undefined) delete process.env.TZ;
      else process.env.TZ = ORIGINAL_TZ;
    });

    it("todayIso '2026-08-31' resolves last month to July east of UTC, not August", () => {
      // A UTC-noon parse of 2026-08-31 lands on 2026-09-01 in Auckland, which
      // would make "last month" August and fire the row against a July-clean
      // household.
      const rows = buildModelGaps(settledInput({ todayIso: '2026-08-31' })).rows;
      expect(rows.find((r) => r.id === 'G3')).toBeUndefined();
    });
  });

  // Review MINOR 1/14: the CONDITION is the canonical provenance string
  // (snapshot-only), but the CONSEQUENCE claims the engine seed. Holdings
  // without snapshots (and 529-only snapshots) seed a non-zero month 0.
  it('G2 is silent when the engine seed is NOT zero (holdings without snapshots)', () => {
    const rows = buildModelGaps(settledInput({ snapshots: [], engineStartsAtZero: false })).rows;
    expect(rows.find((r) => r.id === 'G2')).toBeUndefined();
    expect(rows.find((r) => r.id === 'G3')).toBeDefined();  // the sibling row is unaffected
  });

  it('G2 fires only when the provenance string AND the zero engine seed agree', () => {
    const rows = buildModelGaps(settledInput({ snapshots: [], engineStartsAtZero: true })).rows;
    expect(rows.find((r) => r.id === 'G2')?.text)
      .toBe('No account snapshots yet — the portfolio starts at $0 in these projections.');
  });

  it('G4: no contributions in the trailing 12 months', () => {
    const rows = buildModelGaps(settledInput({ contributions: [] })).rows;
    expect(rows.find((r) => r.id === 'G4')?.text)
      .toBe("No contributions in the last 12 months — the projection assumes none beyond the scenario's contribution levers.");
    expect(rows.find((r) => r.id === 'G4')?.cta).toEqual({ label: 'Open Contributions →', to: '/investments?manage=contributions' });
  });

  it('G4: a contribution older than the trailing window still fires the row', () => {
    const stale: Contribution = { ...recentContribution, date: '2024-06-15' };
    expect(buildModelGaps(settledInput({ contributions: [stale] })).rows.find((r) => r.id === 'G4')?.text)
      .toBe("No contributions in the last 12 months — the projection assumes none beyond the scenario's contribution levers.");
  });

  it('G5 + G6: growth and withdrawal app-defaults surface as named facts', () => {
    const bare = makeHousehold({ ...fullHousehold, growthScenarios: [], withdrawalRate: 0 });
    const rows = buildModelGaps(settledInput({ household: bare })).rows;
    expect(rows.find((r) => r.id === 'G5')?.text).toBe('Growth rate: app default 6% — no growth scenarios set.');
    expect(rows.find((r) => r.id === 'G5')?.cta).toEqual({ label: 'Open Household →', to: '/inputs/household' });
    expect(rows.find((r) => r.id === 'G6')?.text).toBe('Withdrawal rate: app default 4% — not set in Inputs.');
    expect(rows.find((r) => r.id === 'G6')?.cta).toEqual({ label: 'Open Household →', to: '/inputs/household' });
  });

  // C1 (D-C1-6 ⚑, supersedes D-W3-P5): the engine reads ONLY annualSalaryPretax
  // (engine.ts:516) and the employment contract persists 0 for HOURLY
  // (employment-fields.ts:10), so an hourly person's income is $0 in every
  // projection — staying silent for them was a false silence.
  // Review MAJOR 0: the discriminator is employmentType, never the rate alone
  // (the PaycheckCard.tsx:199-202 precedent) — makePerson's employmentType
  // DEFAULTS to SALARY_NO_OT (schema.ts:80), so every G8h fixture states it.
  it('G8 / G8h: every $0-salary person gets a row — hourly workers get the hourly sentence', () => {
    const rows = buildModelGaps(settledInput({
      persons: [
        makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 0, employmentType: 'HOURLY', hourlyRate: 45 }),   // hourly — G8h
        makePerson({ id: 2, name: 'Sam', annualSalaryPretax: 0, hourlyRate: null }),  // no pay at all — G8
      ],
    })).rows;
    const g8 = rows.filter((r) => r.id.startsWith('G8'));
    expect(g8.map((r) => [r.id, r.text])).toEqual([
      ['G8h:1', "Alex is paid hourly — the projection doesn't model hourly pay, so it carries no income for them."],
      ['G8:2', 'Sam has no salary entered — the projection carries no income for them.'],
    ]);
    for (const r of g8) expect(r.cta).toEqual({ label: 'Open Persons →', to: '/inputs/persons' });
  });

  it('G8 / G8h interleave in person-id order (one loop, one home)', () => {
    const rows = buildModelGaps(settledInput({
      persons: [
        makePerson({ id: 3, name: 'Kim', annualSalaryPretax: 0, employmentType: 'HOURLY', hourlyRate: 30 }),
        makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 0 }),
        makePerson({ id: 2, name: 'Sam', annualSalaryPretax: 0, employmentType: 'HOURLY', hourlyRate: 45 }),
      ],
    })).rows;
    expect(rows.filter((r) => r.id.startsWith('G8')).map((r) => r.id)).toEqual(['G8:1', 'G8h:2', 'G8h:3']);
  });

  it('a salaried-with-overtime person (salary > 0, hourly rate set) gets NO row', () => {
    const rows = buildModelGaps(settledInput({
      persons: [makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 90_000, hourlyRate: 45 })],
    })).rows;
    expect(rows.filter((r) => r.id.startsWith('G8'))).toEqual([]);
  });

  // Review MAJOR 0 (fix): the app's own hourly discriminator is employmentType
  // (PaycheckCard.tsx:199-202 rejected salary/rate detection for exactly this
  // misread). employment-fields.ts zeroes salary FOR hourly persons but
  // forbids a $0 salary for NO type, and employmentPatchFromDraft keeps
  // d.hourlyRate for every type — so both salaried shapes below are
  // persistable, and PersonsTab (the row's own CTA destination) labels them
  // 'Salary $0' / 'Salary $0 + OT'. They get G8, which is true for them.
  it('a SALARY_WITH_OT person at $0 salary with an hourly rate gets G8, not the hourly sentence', () => {
    const rows = buildModelGaps(settledInput({
      persons: [makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 0, employmentType: 'SALARY_WITH_OT', hourlyRate: 45 })],
    })).rows;
    expect(rows.filter((r) => r.id.startsWith('G8')).map((r) => [r.id, r.text])).toEqual([
      ['G8:1', 'Alex has no salary entered — the projection carries no income for them.'],
    ]);
  });

  it('a SALARY_NO_OT person carrying a stale hourly rate (an HOURLY → salaried switch) gets G8', () => {
    const rows = buildModelGaps(settledInput({
      persons: [makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 0, employmentType: 'SALARY_NO_OT', hourlyRate: 45 })],
    })).rows;
    expect(rows.filter((r) => r.id.startsWith('G8')).map((r) => [r.id, r.text])).toEqual([
      ['G8:1', 'Alex has no salary entered — the projection carries no income for them.'],
    ]);
  });

  it('an HOURLY person with no rate on file still gets G8 (nothing says they are paid hourly but the type)', () => {
    const rows = buildModelGaps(settledInput({
      persons: [makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 0, employmentType: 'HOURLY', hourlyRate: null })],
    })).rows;
    expect(rows.filter((r) => r.id.startsWith('G8')).map((r) => r.id)).toEqual(['G8:1']);
  });

  // Review MINOR 0 (folded into the MAJOR 0 fix): "carries no income for them"
  // is false the moment a compared scenario models a raise / promotion /
  // job change / sabbatical for that person — the engine seeds currentSalary
  // at the $0 base and then APPLIES the payload's events (apply-real.ts:429-449
  // on engine.ts:514-526). The row goes silent instead of stating it.
  const EVENT_AT = (idx: number) => ({
    ...P(),
    income: {
      perPerson: Array.from({ length: idx + 1 }, (_, i) => (
        i === idx
          ? { annualRaiseRate: 0, events: [{ when: '2027-03-01', type: 'raise' as const, deltaAmount: 5_000 }] }
          : { annualRaiseRate: 0, events: [] }
      )),
    },
  });

  it('G8h stays silent when a compared scenario gives that hourly person an income event', () => {
    const hourly = makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 0, employmentType: 'HOURLY', hourlyRate: 45 });
    const withEvent = settledInput({
      persons: [hourly],
      sides: [{ name: 'Baseline', payload: P() }, { name: 'Aggressive payoff', payload: EVENT_AT(0) }],
    });
    expect(buildModelGaps(withEvent).rows.filter((r) => r.id.startsWith('G8'))).toEqual([]);
    // …and the same person WITHOUT the event still gets the hourly sentence.
    expect(buildModelGaps(settledInput({ persons: [hourly] })).rows.filter((r) => r.id.startsWith('G8')).map((r) => r.id))
      .toEqual(['G8h:1']);
  });

  it('the event guard is PER PERSON INDEX, at the engine\'s own read width (engine.ts:515)', () => {
    const persons = [
      makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 0, employmentType: 'HOURLY', hourlyRate: 45 }),
      makePerson({ id: 2, name: 'Kim', annualSalaryPretax: 0, employmentType: 'HOURLY', hourlyRate: 30 }),
    ];
    // An event on the SECOND entry silences the second person only.
    const second = settledInput({
      persons,
      sides: [{ name: 'Baseline', payload: P() }, { name: 'B', payload: EVENT_AT(1) }],
    });
    expect(buildModelGaps(second).rows.filter((r) => r.id.startsWith('G8')).map((r) => r.id)).toEqual(['G8h:1']);
    // A ONE-entry payload is read for BOTH persons (perPerson[idx] ?? [0]),
    // so its event silences both.
    const shared = settledInput({
      persons,
      sides: [{ name: 'Baseline', payload: P() }, { name: 'B', payload: EVENT_AT(0) }],
    });
    expect(buildModelGaps(shared).rows.filter((r) => r.id.startsWith('G8'))).toEqual([]);
  });

  // The byte-frozen CR-G8 keeps its pre-C1 reach (the same exposure shipped in
  // v1.6.0): only the hourly row's causal clause is narrowed here. Chipped.
  it('G8 (no pay of any kind) still renders under an income event — CR-G8 is byte-frozen', () => {
    const rows = buildModelGaps(settledInput({
      persons: [makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 0 })],
      sides: [{ name: 'Baseline', payload: P() }, { name: 'B', payload: EVENT_AT(0) }],
    })).rows;
    expect(rows.filter((r) => r.id.startsWith('G8')).map((r) => r.id)).toEqual(['G8:1']);
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

  // ── C2 — G11: a VISIBLE scenario that authors $0 in EVERY projected month while the household baseline is set ──
  it('G11: one row per $0 scenario — nothing on file → "assumes nothing is spent" verbatim, with the in-page Expenses action (never a route)', () => {
    const rows = buildModelGaps(settledInput({ scenarioSpending: [AT_ZERO, SET] })).rows;
    expect(rows).toEqual([{
      id: 'G11:1',
      text: "Baseline's expense base is $0 — the projection assumes nothing is spent, so no FI date is shown.",
      cta: { label: 'Open Expenses →', scenarioId: 1, lever: 'expenses' },
    }]);
  });

  it('G11: the engine spends rent or a lease → "counts only rent and vehicle leases as spending" verbatim (C2 review: the first variant would be false)', () => {
    const rows = buildModelGaps(settledInput({ scenarioSpending: [AT_ZERO_RENT, SET] })).rows;
    expect(rows).toEqual([{
      id: 'G11:1',
      text: "Baseline's expense base is $0 — the projection counts only rent and vehicle leases as spending, so no FI date is shown.",
      cta: { label: 'Open Expenses →', scenarioId: 1, lever: 'expenses' },
    }]);
  });

  it('G11: the variant is chosen PER SCENARIO by what its projection spends (obligations), never by the authored fact', () => {
    const rows = buildModelGaps(settledInput({
      scenarioSpending: [{ ...AT_ZERO_RENT, scenarioId: 4, name: 'Renting' }, { ...AT_ZERO, scenarioId: 5, name: 'Nothing' }],
    })).rows;
    expect(rows.map((r) => r.text)).toEqual([G11_OBLIGATIONS('Renting'), G11_NOTHING('Nothing')]);
  });

  it('G11: strip order, one row each, names interpolated verbatim', () => {
    const rows = buildModelGaps(settledInput({
      scenarioSpending: [{ ...AT_ZERO, scenarioId: 7, name: 'From calculators — Sep 24, 2026' }, SET, AT_ZERO],
    })).rows;
    expect(rows.map((r) => r.id)).toEqual(['G11:7', 'G11:1']);
    expect(rows[0].text).toBe("From calculators — Sep 24, 2026's expense base is $0 — the projection assumes nothing is spent, so no FI date is shown.");
  });

  it('G11 is SILENT with a $0 household baseline — G1 owns that moment (mutually exclusive by condition)', () => {
    const rows = buildModelGaps(settledInput({
      household: makeHousehold({ ...fullHousehold, monthlyExpenseBaseline: 0 }),
      scenarioSpending: [AT_ZERO, AT_ZERO_RENT],
    })).rows;
    expect(rows.map((r) => r.id)).toEqual(['G1']);
  });

  it('G11 is silent with no household and silent when every visible scenario authors spending in some month', () => {
    expect(buildModelGaps(settledInput({ household: null, scenarioSpending: [AT_ZERO] })).rows.filter((r) => r.id.startsWith('G11'))).toEqual([]);
    expect(buildModelGaps(settledInput({ scenarioSpending: [SET] })).rows).toEqual([]);
  });

  it('G11 sits directly after G1\'s slot — before G2 (contract order)', () => {
    const rows = buildModelGaps(settledInput({ scenarioSpending: [AT_ZERO], snapshots: [], contributions: [] })).rows;
    expect(rows.map((r) => r.id)).toEqual(['G11:1', 'G2', 'G3', 'G4']);
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

  it('no advice lexeme, no reserved phrase in any row (EVERY row shape, incl. G10n)', () => {
    const seq = { ...P(), withdrawalStrategy: 'sequential' as const };
    const rows = buildModelGaps(settledInput({
      household: makeHousehold({ ...fullHousehold, monthlyExpenseBaseline: 0, growthScenarios: [], withdrawalRate: 0 }),
      snapshots: [], contributions: [], roadmapHasUnanswered: true, settings: null,
      persons: [
        makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 0 }),
        makePerson({ id: 2, name: 'Kim', annualSalaryPretax: 0, employmentType: 'HOURLY', hourlyRate: 45 }),   // C1: the G8h shape
      ],
      sides: [{ name: 'Baseline', payload: seq }, { name: 'B2', payload: seq }],
    })).rows;
    // …plus the one row shape the all-rows fixture cannot reach: G10n, whose
    // text interpolates a scenario name (review MINOR 0 — the scan must cover
    // every row, not just the ones one fixture happens to produce).
    // C2: both G11 shapes (a scenario name interpolated; the two variants) ride
    // the same scan — they cannot co-fire with the all-rows fixture's $0
    // household (G1).
    const named = buildModelGaps(settledInput({
      settings: null,
      scenarioSpending: [AT_ZERO, { ...AT_ZERO_RENT, scenarioId: 2, name: 'Renting' }],
      sides: [{ name: 'Baseline', payload: P() }, { name: 'Aggressive payoff', payload: seq }],
    })).rows.filter((r) => r.id === 'G10' || r.id.startsWith('G11'));
    expect(rows.length).toBeGreaterThanOrEqual(9);
    expect(named).toHaveLength(3);
    for (const r of [...rows, ...named]) {
      expect(r.text).not.toMatch(ADVICE_LEXICON);
      expect(r.cta.label).not.toMatch(ADVICE_LEXICON);
      for (const phrase of RESERVED_PHRASES) expect(r.text).not.toContain(phrase);
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
const GOLDEN_ALL_ROWS = '{"rows":[{"id":"G1","text":"No monthly expense baseline — FI dates can\'t be computed, so they aren\'t shown.","cta":{"label":"Open Household →","to":"/inputs/household"}},{"id":"G2","text":"No account snapshots yet — the portfolio starts at $0 in these projections.","cta":{"label":"Open Accounts →","to":"/investments?manage=accounts"}},{"id":"G3","text":"Last month\'s balances aren\'t confirmed — lines start from the latest figures you\'ve confirmed.","cta":{"label":"Open monthly check-in →","to":"/monthly"}},{"id":"G4","text":"No contributions in the last 12 months — the projection assumes none beyond the scenario\'s contribution levers.","cta":{"label":"Open Contributions →","to":"/investments?manage=contributions"}},{"id":"G5","text":"Growth rate: app default 6% — no growth scenarios set.","cta":{"label":"Open Household →","to":"/inputs/household"}},{"id":"G6","text":"Withdrawal rate: app default 4% — not set in Inputs.","cta":{"label":"Open Household →","to":"/inputs/household"}},{"id":"G8:1","text":"Alex has no salary entered — the projection carries no income for them.","cta":{"label":"Open Persons →","to":"/inputs/persons"}},{"id":"G9","text":"The roadmap has questions you haven\'t answered — its checklist and frameworks assume less until you do.","cta":{"label":"Open Roadmap →","to":"/roadmap"}},{"id":"G10","text":"Drawdown tax rate isn\'t set — sequential withdrawals are modeled untaxed.","cta":{"label":"Open Settings →","to":"/settings"}}]}';
