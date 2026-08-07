import { describe, it, expect } from 'vitest';
import { computeEffect } from '@/lib/interview/effects';
import { splitAmount } from '@/lib/interview/waterfall';
import { makeHousehold, makeAccount, makeLoan } from '../../factories';
import { AccountType } from '@/types/enums';
import { fixtureCtx } from './waterfall.test';

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
