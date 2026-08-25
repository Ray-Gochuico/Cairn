import { describe, it, expect } from 'vitest';
import { computeEffect, computeFiMonthlyDelta } from '@/lib/interview/effects';
import { splitAmount } from '@/lib/interview/waterfall';
import { makeHousehold, makeAccount, makeLoan } from '../../factories';
import { AccountType } from '@/types/enums';
import { fixtureCtx } from './fixture';

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
