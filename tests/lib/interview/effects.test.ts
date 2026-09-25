import { describe, it, expect, afterEach } from 'vitest';
import { computeEffect, computeFiMonthlyDelta, kernelScenario } from '@/lib/interview/effects';
import { splitAmount } from '@/lib/interview/waterfall';
import { makeHousehold, makeAccount, makeLoan } from '../../factories';
import { AccountType } from '@/types/enums';
import { fixtureCtx, snap } from './fixture';
import { ADVICE_LEXICON } from '../../helpers/advice-lexicon';

const GROWTH = [
  { label: 'low', rate: 0.04 }, { label: 'moderate', rate: 0.06 }, { label: 'high', rate: 0.08 },
];

describe('computeEffect — headline selection (D-GI9) + bindings (§3.5)', () => {
  it('one-time Conservative: largest share (B4 $6,000) → EF months-of-expenses delta (CI-27)', () => {
    const s = splitAmount({ amountCents: 1_000_000, cadence: 'one-time' }, 'conservative', fixtureCtx());
    const e = computeEffect(s, fixtureCtx());
    expect(e.headline).toBe(
      'Your cash reserve would cover 6.0 months of expenses, up from 5.0 — based on $30,000 across cash and savings accounts and your entered monthly baseline.',
    );
    // Secondaries: one line per other funded bucket, in bucket order.
    expect(e.secondaries[0]).toBe('Pays Visa from $3,000 down to $0 — highest rate first (22%).');
  });

  it('one-time debt effect is a BALANCE delta, never an interest claim (D-GI10)', () => {
    // All $2,000 lands on the Visa: high bucket largest → headline is CI-31.
    const s = splitAmount({ amountCents: 200_000, cadence: 'one-time' }, 'aggressive', fixtureCtx());
    const e = computeEffect(s, fixtureCtx());
    expect(e.headline).toBe('Pays Visa from $3,000 down to $1,000 — highest rate first (22%).');
    expect(e.headline).not.toMatch(/interest/);
  });

  it('FI delta: two solves differing only in pv for a lump (D-GI6) — hand-derived 1.8 years', () => {
    // pv 130,000 (savings 22k + cash 8k + brokerage 100k — all FI-eligible),
    // pmt 0, target 72,000/0.04 = 1,800,000, real rate (1.06/1.03)−1.
    // t(pv) = ln(1.8e6/pv)/ln(1+r): 91.53 @130k vs 89.70 @137k → Δ ≈ 1.8.
    const ctx = fixtureCtx({
      household: makeHousehold({ monthlyExpenseBaseline: 6000, withdrawalRate: 0.04, inflationAssumption: 0.03, growthScenarios: GROWTH }),
      accounts: [
        ...fixtureCtx().accounts,
        makeAccount({ id: 3, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' }),
      ],
      snapshots: [...fixtureCtx().snapshots, { accountId: 3, snapshotDate: '2026-07-30', totalValue: 100000 } as never],
      loans: [],
    });
    const s = splitAmount({ amountCents: 700_000, cadence: 'one-time' }, 'aggressive', ctx);
    const e = computeEffect(s, ctx);
    expect(e.headline).toBe(
      '≈ 1.8 years sooner to your FI target — two identical projections, one with this lump sum added.',
    );
  });

  it('HISTORICAL ANCHOR (nominal-on-real class): the 10-year fallback is REAL dollars', () => {
    // Baseline 0 → FI not computable → CI-33. $10,000 lump @ 6% nominal,
    // monthly compounding, 10y: nominal 10,000×1.005^120 = $18,193.97;
    // REAL = /1.03^10 (1.343916) = $13,537.99 → $13,538. A nominal-on-real
    // bug would print $18,194 — the assertion below is the tripwire.
    const ctx = fixtureCtx({
      household: makeHousehold({ monthlyExpenseBaseline: 0, inflationAssumption: 0.03, growthScenarios: GROWTH }),
      loans: [],
    });
    const s = splitAmount({ amountCents: 1_000_000, cadence: 'one-time' }, 'aggressive', ctx);
    const e = computeEffect(s, ctx);
    expect(e.headline).toContain('$13,538');
    expect(e.headline).not.toContain('$18,194');
    expect(e.headline).toContain("in today's dollars after 10 years — moderate scenario, inflation-adjusted.");
  });

  it('per-month debt: compareStrategies savings + payoff date; capped schedules suppress figures (CI-30)', () => {
    // Deterministic first-phase debt: aggressive (3× EF covered → skipped,
    // B5 minimums → skipped) + a HIGH-rate loan → phase 1 IS the debt phase.
    const capped = makeLoan({ id: 2, name: 'Trap', currentBalance: 50000, interestRate: 0.06, monthlyPayment: 1, termMonths: 12, firstPaymentDate: '2026-09-01' });
    const high = makeLoan({ id: 3, name: 'Visa', currentBalance: 1000, interestRate: 0.22, monthlyPayment: 500, termMonths: 12, firstPaymentDate: '2026-09-01' });
    const s = splitAmount({ amountCents: 100_000, cadence: 'per-month' }, 'aggressive', fixtureCtx({ loans: [high] }));
    const e = computeEffect(s, fixtureCtx({ loans: [high] }));
    expect(e.headline).toMatch(/^≈ \$[\d,]+ less interest and paid off /);
    expect(e.headline).toContain('your 1 loan at 8% or more, highest rate first, vs. minimum payments.');
    const sCap = splitAmount({ amountCents: 100_000, cadence: 'per-month' }, 'conservative', fixtureCtx({ loans: [capped] }));
    const eCap = computeEffect(sCap, fixtureCtx({ loans: [capped] }));
    expect(eCap.secondaries.join('\n')).toContain(
      "The stated payment can't amortize this balance — interest and payoff figures aren't shown.",
    );
  });
});

describe('computeEffect — CI-28 EF funded date (review M1)', () => {
  it('two EF phases: the date accumulates through the LAST EF phase, not the first', () => {
    // Reserve $0, baseline $6,000, no loans, Conservative $1,000/mo:
    // phase 1 ef_floor 6 months ($6,000 gap), phase 2 ef_target 30 months
    // ($36,000 − $6,000), then ongoing invest. Fully funded = Aug 2026 + 36
    // = August 2029 — NOT February 2027 (the first phase's end).
    const ctx = fixtureCtx({ snapshots: [], loans: [] });
    const s = splitAmount({ amountCents: 100_000, cadence: 'per-month' }, 'conservative', ctx);
    expect(s.phases.map((p) => [p.months, p.rows.map((r) => r.bucket)])).toEqual([
      [6, ['ef_floor']],
      [30, ['ef_target']],
      [null, ['invest']],
    ]);
    const e = computeEffect(s, ctx);
    expect(e.headline).toContain('Emergency fund fully funded by August 2029 at this pace');
  });

  it('an unbounded (months=null) phase before the EF phase suppresses the CI-28 line entirely', () => {
    // Capped high-rate loan → its phase has months=null and precedes the EF
    // phase; a concrete funded date would be fabricated. No EF date line at
    // all (mirrors the CI-30 suppression ethos; no new copy).
    // $600,000 @ 22% accrues ≈ $11,000/mo interest — the $1 payment plus the
    // whole $1,000/mo flow can never amortize it, so the schedule stays capped.
    const capped = makeLoan({ id: 9, name: 'Trap', currentBalance: 600000, interestRate: 0.22, monthlyPayment: 1, termMonths: 12, firstPaymentDate: '2026-09-01' });
    const ctx = fixtureCtx({ loans: [capped] });
    const s = splitAmount({ amountCents: 100_000, cadence: 'per-month' }, 'conservative', ctx);
    // Shape sanity: null-months debt phase, then the EF phase.
    expect(s.phases[0].months).toBeNull();
    expect(s.phases[1].rows.some((r) => r.bucket === 'ef_target')).toBe(true);
    const e = computeEffect(s, ctx);
    expect(e.headline).not.toContain('Emergency fund fully funded');
    expect(e.secondaries.join('\n')).not.toContain('Emergency fund fully funded');
  });
});

describe('computeFiMonthlyDelta (T3 standalone two-solve, D-T3-16)', () => {
  // Same FI-computable ctx the lump-delta test uses: 30k reserve (aggressive
  // 3× covered), 100k brokerage, no loans → a $1,000/mo aggressive split is
  // ALL invest, so computeEffect's headline IS investLine's per-month delta.
  const fiCtx = () => fixtureCtx({
    household: makeHousehold({
      monthlyExpenseBaseline: 6000, withdrawalRate: 0.04,
      inflationAssumption: 0.03, growthScenarios: GROWTH,
    }),
    accounts: [
      ...fixtureCtx().accounts,
      makeAccount({ id: 3, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' }),
    ],
    snapshots: [
      ...fixtureCtx().snapshots,
      { accountId: 3, snapshotDate: '2026-07-30', totalValue: 100000 } as never,
    ],
    loans: [],
  });

  it('PARITY: matches the years figure investLine renders for a per-month invest split', () => {
    const ctx = fiCtx();
    const s = splitAmount({ amountCents: 100_000, cadence: 'per-month' }, 'aggressive', ctx);
    const e = computeEffect(s, ctx);
    const m = e.headline.match(/≈ (\d+(?:\.\d)?) years sooner/);
    expect(m).not.toBeNull(); // recipe drift in investLine breaks here…
    const r = computeFiMonthlyDelta(ctx, 1_000);
    expect(r.kind).toBe('delta');
    if (r.kind === 'delta') expect(r.years.toFixed(1)).toBe(m![1]); // …or here.
  });

  it('no expense baseline ⇒ not-computable (never a fabricated delta)', () => {
    const ctx = fixtureCtx({
      household: makeHousehold({ monthlyExpenseBaseline: 0, growthScenarios: GROWTH }),
    });
    expect(computeFiMonthlyDelta(ctx, 300)).toEqual({ kind: 'not-computable' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R1 Appendix K1 (CR-R1-3, ruling 4's noun): the effect line's basis phrase
// states the COUNT when the baseline came from transactions. The household
// branch is unchanged (pinned above at 'entered monthly baseline').
// ─────────────────────────────────────────────────────────────────────────────
describe('computeEffect — count-stated basis phrase (R1 K1)', () => {
  // fixtureCtx.today = 2026-08-01 → complete-month window 2025-08 … 2026-07.
  // Every month carries $6,000, so the baseline matches the fixture household's
  // $6,000 and ONLY the phrase moves — the arithmetic is held constant.
  const spend = (id: number, date: string) =>
    ({ id, householdId: 1, date, amount: 6000, merchant: 'M', merchantRaw: null, categoryId: 1, sourceAccountId: 1 } as never);
  const monthsBack = (n: number) => Array.from({ length: n }, (_, i) => {
    const idx = 2026 * 12 + 7 - n + i; // ends at 2026-07 (the window's last complete month)
    return spend(i + 1, `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-05`);
  });
  const headlineFor = (n: number) => {
    const ctx = fixtureCtx({ transactions: monthsBack(n) });
    return computeEffect(splitAmount({ amountCents: 1_000_000, cadence: 'one-time' }, 'conservative', ctx), ctx).headline;
  };

  it('n = 3 reads "your spending over 3 months"', () => {
    expect(headlineFor(3)).toBe(
      'Your cash reserve would cover 6.0 months of expenses, up from 5.0 — based on $30,000 across cash and savings accounts and your spending over 3 months.',
    );
  });

  it('n = 1 pluralizes as "month"', () => {
    expect(headlineFor(1)).toBe(
      'Your cash reserve would cover 6.0 months of expenses, up from 5.0 — based on $30,000 across cash and savings accounts and your spending over 1 month.',
    );
  });

  it('n = 12 states twelve — never an "{n}-month" baseline noun (ruling 4)', () => {
    const h = headlineFor(12);
    expect(h).toBe(
      'Your cash reserve would cover 6.0 months of expenses, up from 5.0 — based on $30,000 across cash and savings accounts and your spending over 12 months.',
    );
    expect(h).not.toMatch(/spending baseline/);
  });

  it('no new string carries an advice lexeme or an exclamation', () => {
    for (const n of [1, 3, 12]) {
      expect(headlineFor(n)).not.toMatch(ADVICE_LEXICON);
      expect(headlineFor(n)).not.toContain('!');
    }
  });
});

describe('kernelScenario — the kernel\'s one scenario/real-rate seam (R4 D-R4-6)', () => {
  it('todayIso is the LOCAL day; realRate is the unfloored Fisher rate of the moderate scenario', () => {
    const ctx = fixtureCtx({
      household: makeHousehold({ monthlyExpenseBaseline: 6000, inflationAssumption: 0.03, growthScenarios: GROWTH }),
    });
    const k = kernelScenario(ctx);
    expect(k.todayIso).toBe('2026-08-01');
    expect(k.defaults.returnPct).toBe(6);
    expect(k.defaults.inflationPct).toBe(3);
    expect(k.realRate).toBeCloseTo(1.06 / 1.03 - 1, 12);
    expect(k.defaults.portfolio).toBe(30_000); // savings 22k + checking 8k — FI-eligible (cash counts)
    expect(k.provenance.annualContribution).toBe('no contributions in the last 12 months');
    expect(k.provenance.portfolio).toBe('from your account snapshots');
  });
});

describe('CI-28 EF funded date — the day-31 overflow arm (ruling 1: every zone, not only east of Greenwich)', () => {
  it('Jan 31 + ONE EF month reads February 2026 (the shipped setUTCMonth idiom read "March 2026")', () => {
    // Baseline $1,000, reserve $5,000: the 1× floor is covered; the 6× target
    // ($6,000, assumed — jobStability null) leaves a $1,000 gap → ONE ef_target
    // month at $1,000/mo; then ongoing invest. cumulative = 1.
    const ctx = fixtureCtx({
      household: makeHousehold({ monthlyExpenseBaseline: 1000 }),
      snapshots: [snap(1, 5000)], loans: [], today: new Date(2026, 0, 31),
    });
    const s = splitAmount({ amountCents: 100_000, cadence: 'per-month' }, 'conservative', ctx);
    expect(s.phases.map((p) => [p.months, p.rows.map((r) => r.bucket)])).toEqual([
      [1, ['ef_target']],
      [null, ['invest']],
    ]);
    const e = computeEffect(s, ctx);
    expect(e.headline).toContain('Emergency fund fully funded by February 2026 at this pace');
    expect(e.headline).not.toContain('March');
  });

  it('Aug 31 + SIX EF months reads February 2027 (shipped: Feb 31 → Mar 3 → "March 2027")', () => {
    // Baseline $1,000, no reserve: floor $1,000 → 1 month; target 6× → $5,000 more → 5 months; cumulative 6.
    const ctx = fixtureCtx({
      household: makeHousehold({ monthlyExpenseBaseline: 1000 }),
      snapshots: [], loans: [], today: new Date(2026, 7, 31),
    });
    const s = splitAmount({ amountCents: 100_000, cadence: 'per-month' }, 'conservative', ctx);
    expect(s.phases.map((p) => p.months)).toEqual([1, 5, null]);
    expect(computeEffect(s, ctx).headline).toContain('Emergency fund fully funded by February 2027 at this pace');
  });
});

describe('U3 — the payoff month follows the LOCAL day (cross-zone invariance: Pacific/Auckland reads what UTC reads)', () => {
  // R4 plan-premise correction: the plan's "local Sep 1 equals local Sep 15"
  // invariance is false on this fixture — the Visa pays on the 1st, so the
  // local 1st and the 15th are different schedules in EVERY zone. The honest
  // oracle is the UTC zone, where the UTC day of a local-midnight Date IS the
  // local day (the shipped code was already right there): the same LOCAL day
  // must read the same line in Auckland, whose UTC day is the PRIOR day.
  const ORIGINAL_TZ = process.env.TZ;
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });
  const headlineAt = (tz: string, day: number): string => {
    process.env.TZ = tz;
    // Reserve $48,000 ≥ 6× $36,000 → every EF bucket skipped; Aggressive
    // per-month $1,000 → phase 1 is the Visa (22%) → perMonthDebtLine is the headline.
    const ctx = fixtureCtx({ today: new Date(2026, 8, day), snapshots: [snap(1, 40000), snap(2, 8000)] });
    const s = splitAmount({ amountCents: 100_000, cadence: 'per-month' }, 'aggressive', ctx);
    return computeEffect(s, ctx).headline;
  };
  it('local Sep 1, Sep 2 and Sep 15: the Auckland headline equals the UTC headline', () => {
    expect(headlineAt('Pacific/Auckland', 1)).toMatch(/paid off [A-Z][a-z]+ \d{4} — your 1 loan at 8% or more/);
    for (const day of [1, 2, 15]) expect(headlineAt('Pacific/Auckland', day)).toBe(headlineAt('UTC', day));
    // Non-vacuity: a ONE-day shift moves the payoff month (Sep 1 → Sep 2 crosses
    // the Visa's payment day), so the prior-UTC-day read reds the Sep 2 arm.
    expect(headlineAt('UTC', 2)).not.toBe(headlineAt('UTC', 1));
  });
});
