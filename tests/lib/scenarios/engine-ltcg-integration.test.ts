import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Bracket } from '@/lib/tax';

// -----------------------------------------------------------------------------
// Wiring-sweep R2 — verify the projection engine taxes long-term capital gains
// at the 2026 LTCG schedule (0% / 15% / 20%) instead of as ordinary income.
//
// Pre-fix: engine.ts:99-109 only passed `gross` to computeTotalTax. A scenario
// where someone realized $50k of LTCG on top of $200k W-2 was being:
//   (a) NOT taxed for the LTCG at all if the engine never saw it (the actual
//       behavior — Person.annualSalaryPretax is the only income input), OR
//   (b) silently double-taxed if any consumer pre-summed it into gross.
//
// Post-fix: the engine threads LTCG-bearing income through ltcgBrackets so the
// federal LTCG tax is reported correctly. Same ordinary income yields the
// same federal income tax, but the LTCG-bearing path nets a different total.
// -----------------------------------------------------------------------------

// 2026 federal MFJ ordinary brackets (post-0031).
const FED_MFJ_2026: Bracket[] = [
  { min: 0,       max: 24800,  rate: 0.10 },
  { min: 24800,   max: 100800, rate: 0.12 },
  { min: 100800,  max: 211400, rate: 0.22 },
  { min: 211400,  max: 403550, rate: 0.24 },
  { min: 403550,  max: 512450, rate: 0.32 },
  { min: 512450,  max: 768700, rate: 0.35 },
  { min: 768700,  max: null,   rate: 0.37 },
];

// 2026 federal MFJ LTCG brackets (post-0032).
const LTCG_MFJ_2026: Bracket[] = [
  { min: 0,      max: 98900,  rate: 0.0 },
  { min: 98900,  max: 613700, rate: 0.15 },
  { min: 613700, max: null,   rate: 0.20 },
];

function buildReal(opts: {
  annualSalary: number;
  ltcgBrackets?: Bracket[];
}): RealState {
  return {
    accounts: [],
    holdings: [],
    loans: [],
    loanPayments: [],
    household: { id: 1, filingStatus: 'MFJ' } as RealState['household'],
    persons: [
      {
        id: 1,
        householdId: 1,
        displayName: 'A',
        annualSalaryPretax: opts.annualSalary,
        targetRetirementAge: 100,
      } as unknown as RealState['persons'][0],
    ],
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 0,
    initialInvestmentsByAccount: {},
    cashAccountsWithBalances: [],
    defaults: { inflation: 0, returnRate: 0, defaultCashApy: null },
    startISO: '2026-01',
    taxBrackets: {
      federal: FED_MFJ_2026,
      state: [],
      city: null,
      standardDeduction: { federal: 32200, state: 0, city: 0 },
      ...(opts.ltcgBrackets ? { ltcg: opts.ltcgBrackets } : {}),
    } as RealState['taxBrackets'],
  };
}

describe('engine LTCG integration (R2 wiring-sweep)', () => {
  it('LTCG income yields a different projection than the same gross as ordinary income', () => {
    // Scenario A: $200k MFJ salary + $50k LTCG realised annually (via the
    // engine's annual-LTCG payload field).
    const realA = buildReal({ annualSalary: 200_000, ltcgBrackets: LTCG_MFJ_2026 });
    const payloadA = emptyLeverPayload();
    // Annualized LTCG income — fed into the engine's annualHouseholdLtcg path.
    (payloadA as unknown as { annualLongTermGains: number }).annualLongTermGains = 50_000;
    payloadA.expensePeriods = [{ start: '2026-01-01', monthlyDelta: 0, durationMonths: 24 }];
    payloadA.returns.defaultRate = 0;
    const statesA = projectScenario(realA, payloadA, { startISO: '2026-01', months: 13 });

    // Scenario B: identical $200k MFJ salary but NO ltcgBrackets / no
    // annualLongTermGains. Same gross income picture, no LTCG modelling.
    const realB = buildReal({ annualSalary: 200_000 });
    const payloadB = emptyLeverPayload();
    payloadB.expensePeriods = [{ start: '2026-01-01', monthlyDelta: 0, durationMonths: 24 }];
    payloadB.returns.defaultRate = 0;
    const statesB = projectScenario(realB, payloadB, { startISO: '2026-01', months: 13 });

    // After 12 months, the cumulative tax delta should be the LTCG tax on $50k
    // stacked above $200k - $32,200 SD = $167,800 ordinary taxable. The next
    // $50k of qualified income spans the 0% bracket up to $98,900 = $0 tax on
    // the first chunk and then 15% on the remainder. With $167,800 as
    // ordinary post-SD, the qualified $50k all sits ABOVE the $98,900 0%
    // threshold (since stack-bottom = $167,800), so it's all taxed at 15% =
    // $7,500/yr.
    //
    // The "no LTCG modelling" path under-collects that $7,500 — so cumulative
    // after-tax income (= savings → cash) over 12 months should be HIGHER by
    // ~$7,500.
    const endA = statesA[statesA.length - 1];
    const endB = statesB[statesB.length - 1];

    // The cash piles should diverge by ~$7,500 (the LTCG tax that A pays and
    // B does not). Use a generous tolerance because engine flow has many
    // small rounding boundaries.
    expect(endB.cash - endA.cash).toBeGreaterThan(5000);
    expect(endB.cash - endA.cash).toBeLessThan(10000);
  });
});
