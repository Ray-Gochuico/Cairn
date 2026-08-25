import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { evaluateThread } from '@/domain/interview/evaluate';
import { HOME_PURCHASE_THREAD, recordUpcomingPurchase } from '@/domain/interview/threads/home-purchase';
import { INTERVIEW_THREADS } from '@/domain/interview/registry';
import { useHouseholdStore } from '@/stores/household-store';
import { PropertyType, AccountType } from '@/types/enums';
import { answerKey, type InterviewAnswer, type InterviewContext } from '@/types/interview';
import { makeHousehold, makePerson, makeProperty, makeAccount } from '../../factories';
import { fixtureCtx, snap } from '../../lib/interview/fixture';
import type { HousingPayment } from '@/types/schema';

const rent = (): HousingPayment => ({
  id: 1, householdId: 1, ownerPersonId: null, name: 'Rent',
  monthlyAmount: 2200, startDate: '2025-01-01', endDate: null,
} as HousingPayment);

const HOUSE_HOUSEHOLD = () => makeHousehold({
  monthlyExpenseBaseline: 6000,
  growthScenarios: [{ label: 'moderate', rate: 0.05 }],
});

const renterCtx = (answers: Map<string, InterviewAnswer> = new Map(), extra: Partial<InterviewContext> = {}) =>
  fixtureCtx({ household: HOUSE_HOUSEHOLD(), housingPayments: [rent()], interviewAnswers: answers, ...extra });

const row = (questionId: string, valueJson: string): [string, InterviewAnswer] => [
  answerKey('home_purchase', questionId, ''),
  {
    id: 1, householdId: 1, threadId: 'home_purchase', questionId,
    subjectKey: '', valueJson, questionVersion: 1,
    answeredAt: '2026-07-01T00:00:00.000Z', basisJson: '{"branch":"not-owner"}',
  },
];

describe('home_purchase thread — registration + tenure branch', () => {
  it('registered third, household-scoped, no per-instance subject', () => {
    expect(INTERVIEW_THREADS.map((t) => t.id)).toEqual(['next_dollar', 'vehicle_replacement', 'home_purchase']);
    expect(HOME_PURCHASE_THREAD.scope).toBe('household');
    expect(HOME_PURCHASE_THREAD.subject).toBeUndefined();
  });

  it('owner (any PRIMARY_RESIDENCE property) → hidden (D-HP1: no owner card, ever)', () => {
    const ctx = fixtureCtx({ properties: [makeProperty({ id: 1, type: PropertyType.PRIMARY_RESIDENCE })] });
    expect(evaluateThread(HOME_PURCHASE_THREAD, ctx, '')).toEqual({ state: 'hidden' });
  });

  it('renter (active housing payment) → asks q_want_house, basis pinned not-owner/renter', () => {
    const r = evaluateThread(HOME_PURCHASE_THREAD, renterCtx(), '');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.node.id).toBe('q_want_house');
    expect(r.node.staleAfterMonths).toBe(24);
    expect(r.pinBasis?.branch).toBe('not-owner');
    expect(r.pinBasis?.facts.tenure).toBe('renter');
  });

  it('unknown (no property, no housing payments) → still asks (facts.tenure unknown)', () => {
    const r = evaluateThread(HOME_PURCHASE_THREAD, fixtureCtx({ household: HOUSE_HOUSEHOLD() }), '');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.pinBasis?.facts.tenure).toBe('unknown');
  });

  it('D-HP3: a renter↔unknown flip never re-asks (both pin branch not-owner)', () => {
    const answers = new Map([row('q_want_house', '"no"')]);
    expect(evaluateThread(HOME_PURCHASE_THREAD, renterCtx(answers), '').state).toBe('reply');
    const unknownCtx = fixtureCtx({ household: HOUSE_HOUSEHOLD(), interviewAnswers: answers });
    expect(evaluateThread(HOME_PURCHASE_THREAD, unknownCtx, '').state).toBe('reply');
  });

  it('answered rows go inert (hidden, not deleted) when the household becomes an owner', () => {
    const answers = new Map([row('q_want_house', '"yes-within-5y"'), row('q_target', '{"amountDollars":60000,"targetMonth":"2028-06"}')]);
    const ctx = renterCtx(answers, { properties: [makeProperty({ id: 1, type: PropertyType.PRIMARY_RESIDENCE })] });
    expect(evaluateThread(HOME_PURCHASE_THREAD, ctx, '')).toEqual({ state: 'hidden' });
  });
});

describe('home_purchase — info replies (CI-H12/CI-H13)', () => {
  it("'no' → reply_no_plans, exact copy", () => {
    const r = evaluateThread(HOME_PURCHASE_THREAD, renterCtx(new Map([row('q_want_house', '"no"')])), '');
    expect(r.state).toBe('reply');
    if (r.state !== 'reply') return;
    expect(r.reply).toEqual({
      kind: 'info',
      lines: ['Nothing computed — you said no home-purchase plans. This question comes back in 24 months.'],
    });
  });

  it("'someday' → reply_someday, exact copy", () => {
    const r = evaluateThread(HOME_PURCHASE_THREAD, renterCtx(new Map([row('q_want_house', '"someday"')])), '');
    expect(r.state).toBe('reply');
    if (r.state !== 'reply') return;
    expect(r.reply).toEqual({
      kind: 'info',
      lines: ['Nothing computed — you said a home purchase is someday, not within 5 years. This question comes back in 24 months.'],
    });
  });
});

describe('home_purchase — the plan reply (hand-computed, fixture: reserve $30,000, baseline $6,000, moderate 5%)', () => {
  const answeredBoth = () => new Map([
    row('q_want_house', '"yes-within-5y"'),
    row('q_target', '{"amountDollars":60000,"targetMonth":"2028-06"}'),
  ]);

  it("'yes-within-5y' alone → asks q_target (the compound arm)", () => {
    const r = evaluateThread(HOME_PURCHASE_THREAD, renterCtx(new Map([row('q_want_house', '"yes-within-5y"')])), '');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.node.id).toBe('q_target');
    expect(r.node.answer.kind).toBe('amount-month-year');
  });

  it('the full plan card: reserve line, EF declaration, plan line — exact strings', () => {
    // HAND-DERIVED (re-derive by these formulas against computeGoalProgress
    // before touching any pin; record the derivation in this comment):
    //   today 2026-08-01 (fixture) → target 2028-06 → monthsUntilTarget = 22.
    //   remaining = 60,000 − 30,000 = 30,000 → linear = 30,000/22 = 1,363.6 → $1,364.
    //   r_m = 0.05/12; FV(30,000) = 30,000×(1+r_m)^22 ≈ 32,873.7;
    //   gap = 27,126.3; PMT = gap×r_m/((1+r_m)^22 − 1) ≈ 1,180 → $1,180.
    //   overlap = min(30,000, 6×6,000 = 36,000) = 30,000, ASSUMED (jobStability null).
    const r = evaluateThread(HOME_PURCHASE_THREAD, renterCtx(answeredBoth()), '');
    expect(r.state).toBe('reply');
    if (r.state !== 'reply') return;
    expect(r.reply.kind).toBe('plan');
    if (r.reply.kind !== 'plan') return;
    expect(r.reply.title).toBe('Home down payment');
    expect(r.reply.lines).toEqual([
      'Cash and savings on hand: $30,000 — from your latest account snapshots.',
      "Of that, $30,000 is also the emergency fund the Moderate framework targets (6× expenses, assumed). The same dollars can't fund both.",
      'Saving $1,364/mo reaches $60,000 by June 2028; about $1,180/mo if savings grow at 5% (moderate scenario).',
    ]);
    expect(r.reply.assumes).toEqual([
      'Counts your full cash and savings as down-payment savings — nothing is set aside for emergencies, closing costs, or moving.',
      "No affordability math here — mortgage rates, PMI, and debt-to-income aren't modeled, and this app fetches no reference data. The target is your number, not a suggestion.",
    ]);
    expect(r.answeredPath.map((p) => p.node.id)).toEqual(['q_want_house', 'q_target']);
  });

  it('an HSA account appends the CI-H4 exclusion sentence and does NOT change the reserve', () => {
    const base = renterCtx(answeredBoth());
    const ctx = renterCtx(answeredBoth(), {
      accounts: [...base.accounts, makeAccount({ id: 3, type: AccountType.ACCOUNT_HSA, name: 'HSA' })],
      snapshots: [...base.snapshots, snap(3, 5000)],
    });
    const r = evaluateThread(HOME_PURCHASE_THREAD, ctx, '');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected plan');
    expect(r.reply.lines[0]).toBe(
      "Cash and savings on hand: $30,000 — from your latest account snapshots. HSA balances aren't counted toward a down payment.",
    );
  });

  it('already covered (target ≤ reserve) → CI-H7, no monthly figures', () => {
    const answers = new Map([row('q_want_house', '"yes-within-5y"'), row('q_target', '{"amountDollars":20000,"targetMonth":"2028-06"}')]);
    const r = evaluateThread(HOME_PURCHASE_THREAD, renterCtx(answers), '');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected plan');
    expect(r.reply.lines).toContain('Your cash and savings already cover the $20,000 target.');
    expect(r.reply.lines.join('\n')).not.toMatch(/\/mo/);
  });

  it('a stored target aging into its month → CI-H8, never Infinity', () => {
    const answers = new Map([row('q_want_house', '"yes-within-5y"'), row('q_target', '{"amountDollars":60000,"targetMonth":"2026-08"}')]);
    const r = evaluateThread(HOME_PURCHASE_THREAD, renterCtx(answers), '');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected plan');
    expect(r.reply.lines).toContain('August 2026 has arrived — $30,000 of the $60,000 target is on hand.');
    expect(r.reply.lines.join('\n')).not.toMatch(/Infinity/);
  });

  it("no baseline → CI-H5b (the overlap can't be sized; nothing fabricated)", () => {
    const answers = answeredBoth();
    const ctx = renterCtx(answers, {
      household: makeHousehold({ monthlyExpenseBaseline: 0, growthScenarios: [{ label: 'moderate', rate: 0.05 }] }),
    });
    const r = evaluateThread(HOME_PURCHASE_THREAD, ctx, '');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected plan');
    expect(r.reply.lines).toContain(
      "Some of this reserve is your emergency fund — it can't be sized without an expense baseline.",
    );
  });

  it('f2 (review): a $0 reserve renders NO EF declaration, even without a baseline', () => {
    // "Some of this reserve is your emergency fund" is a false sentence when
    // there is no reserve — CI-H5b gates on reserve > 0, mirroring CI-H5's
    // overlapDollars > 0 guard (coordinator ruling; string byte-identical).
    const ctx = renterCtx(answeredBoth(), {
      household: makeHousehold({ monthlyExpenseBaseline: 0, growthScenarios: [{ label: 'moderate', rate: 0.05 }] }),
      accounts: [],
      snapshots: [],
    });
    const r = evaluateThread(HOME_PURCHASE_THREAD, ctx, '');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected plan');
    expect(r.reply.lines[0]).toBe('Cash and savings on hand: $0 — from your latest account snapshots.');
    expect(r.reply.lines.join('\n')).not.toMatch(/emergency fund/);
  });

  it('CI-H11 sync row renders ONLY from live household state', () => {
    const inSync = renterCtx(answeredBoth(), {
      household: { ...HOUSE_HOUSEHOLD(), upcomingLargePurchase: true, upcomingPurchaseAmount: 60000, upcomingPurchaseMonths: 22 },
    });
    const r = evaluateThread(HOME_PURCHASE_THREAD, inSync, '');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected plan');
    expect(r.reply.assumes).toContain("Also recorded as the Roadmap's upcoming large purchase.");
    // Divergent amount → no claim:
    const diverged = renterCtx(answeredBoth(), {
      household: { ...HOUSE_HOUSEHOLD(), upcomingLargePurchase: true, upcomingPurchaseAmount: 15000, upcomingPurchaseMonths: 4 },
    });
    const r2 = evaluateThread(HOME_PURCHASE_THREAD, diverged, '');
    if (r2.state !== 'reply' || r2.reply.kind !== 'plan') throw new Error('expected plan');
    expect(r2.reply.assumes).not.toContain("Also recorded as the Roadmap's upcoming large purchase.");
  });

  it('D-GI16 inherited: a corrupt q_target value re-asks, never crashes', () => {
    const answers = new Map([row('q_want_house', '"yes-within-5y"'), row('q_target', '{"amountDollars":-5}')]);
    const r = evaluateThread(HOME_PURCHASE_THREAD, renterCtx(answers), '');
    expect(r.state).toBe('ask');
    if (r.state === 'ask') expect(r.reason).toBe('unanswered');
  });
});

describe('recordUpcomingPurchase — the D-HP4 write-through', () => {
  const update = vi.fn(async () => {});
  beforeEach(() => {
    update.mockClear();
    useHouseholdStore.setState({ update } as never);
  });

  it('within the 60-month window: one patch, all three fields (2026-08 → 2028-06 = 22 months)', async () => {
    await recordUpcomingPurchase({ amountDollars: 60000, targetMonth: '2028-06' }, new Date('2026-08-01T12:00:00Z'));
    expect(update).toHaveBeenCalledWith({
      upcomingLargePurchase: true, upcomingPurchaseAmount: 60000, upcomingPurchaseMonths: 22,
    });
  });

  it('beyond 60 months (2033-06 = 82): writes NOTHING (skips write nothing)', async () => {
    await recordUpcomingPurchase({ amountDollars: 60000, targetMonth: '2033-06' }, new Date('2026-08-01T12:00:00Z'));
    expect(update).not.toHaveBeenCalled();
  });

  it('a non-future month writes NOTHING (defense in depth behind the control)', async () => {
    await recordUpcomingPurchase({ amountDollars: 60000, targetMonth: '2026-08' }, new Date('2026-08-01T12:00:00Z'));
    expect(update).not.toHaveBeenCalled();
  });

  // f3 (review): the D-HP4 window boundaries, pinned exactly. Local-midnight
  // dates — with f1 these are TZ-agnostic (localTodayISO(today) reads the
  // LOCAL calendar in every zone).
  it('months exactly 1 (2026-08 → 2026-09): writes upcomingPurchaseMonths 1', async () => {
    await recordUpcomingPurchase({ amountDollars: 60000, targetMonth: '2026-09' }, new Date(2026, 7, 1));
    expect(update).toHaveBeenCalledWith({
      upcomingLargePurchase: true, upcomingPurchaseAmount: 60000, upcomingPurchaseMonths: 1,
    });
  });

  it('months exactly 60 (2026-08 → 2031-08): writes upcomingPurchaseMonths 60', async () => {
    await recordUpcomingPurchase({ amountDollars: 60000, targetMonth: '2031-08' }, new Date(2026, 7, 1));
    expect(update).toHaveBeenCalledWith({
      upcomingLargePurchase: true, upcomingPurchaseAmount: 60000, upcomingPurchaseMonths: 60,
    });
  });

  it('months exactly 61 (2026-08 → 2031-09): writes NOTHING', async () => {
    await recordUpcomingPurchase({ amountDollars: 60000, targetMonth: '2031-09' }, new Date(2026, 7, 1));
    expect(update).not.toHaveBeenCalled();
  });
});

describe('f1 (review): the day is the LOCAL calendar day, never the UTC one', () => {
  // In any UTC+ zone, local midnight on the 1st is still the PRIOR day in
  // UTC — toISOString().slice(0,10) computed from the prior month (+1 month
  // written; a 60-month target computed 61 and silently skipped the write
  // the control just allowed), diverging from the compound control's own
  // local-day validation. The fix routes both sites through
  // localTodayISO(today) (@/lib/dates — the inverse of dateFromLocalISO).
  // TZ is scoped to this describe: Node's process.env.TZ interceptor resets
  // the date-time configuration on assignment (verified in this repo's Node).
  const ORIGINAL_TZ = process.env.TZ;
  const update = vi.fn(async () => {});
  beforeEach(() => {
    process.env.TZ = 'Pacific/Auckland'; // UTC+12/+13 — local midnight is the prior UTC day
    update.mockClear();
    useHouseholdStore.setState({ update } as never);
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it('a 60-month target saved at local midnight on the 1st WRITES (the UTC day computed 61 and skipped)', async () => {
    // Local 2026-09-01 00:00 NZST = 2026-08-31T12:00Z. Local calendar:
    // 2026-09 → 2031-09 = 60 months, inside the window.
    await recordUpcomingPurchase({ amountDollars: 60000, targetMonth: '2031-09' }, new Date(2026, 8, 1));
    expect(update).toHaveBeenCalledWith({
      upcomingLargePurchase: true, upcomingPurchaseAmount: 60000, upcomingPurchaseMonths: 60,
    });
  });

  it('months count from the local month (24, not the UTC month’s 25)', async () => {
    await recordUpcomingPurchase({ amountDollars: 60000, targetMonth: '2028-09' }, new Date(2026, 8, 1));
    expect(update).toHaveBeenCalledWith({
      upcomingLargePurchase: true, upcomingPurchaseAmount: 60000, upcomingPurchaseMonths: 24,
    });
  });

  it('d_tenure classifies a lease that starts today (local) as renter, not unknown', () => {
    const lease: HousingPayment = { ...rent(), startDate: '2026-09-01' };
    const ctx = fixtureCtx({
      household: HOUSE_HOUSEHOLD(),
      housingPayments: [lease],
      today: new Date(2026, 8, 1), // local midnight on the lease's start day
    });
    const r = evaluateThread(HOME_PURCHASE_THREAD, ctx, '');
    expect(r.state).toBe('ask');
    if (r.state !== 'ask') return;
    expect(r.pinBasis?.facts.tenure).toBe('renter');
  });
});
