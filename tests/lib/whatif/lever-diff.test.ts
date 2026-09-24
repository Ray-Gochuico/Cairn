import { describe, it, expect } from 'vitest';
import {
  emptyLeverPayload, LeverPayloadSchema, effectiveSwr, projectScenario,
  type LeverPayload, type MonthlyState, type RealState,
} from '@/lib/scenarios';
import { effectiveCashApy } from '@/lib/scenarios/effective-cash-apy';
import { summarizeLevers } from '@/lib/whatif/lever-summary';
import {
  PLAN_LEVER_KEYS, ASSUMPTION_LEVER_KEYS, canonicalJson,
  computeAssumptionParity, buildLeverDiff, effectiveSwrOf, effectiveDrawdownTaxOf,
  engineBaselineInflationOf, engineCashApyOf, engineRetirementAgesOf,
  type EngineContext,
} from '@/lib/whatif/lever-diff';
import { AccountType } from '@/types/enums';
import type { Account, AppSettings, Household, Person } from '@/types/schema';
import type { Scenario } from '@/types/scenario';
import { makeHousehold } from '../../factories';

const P = () => emptyLeverPayload();
const HH = makeHousehold({ withdrawalRate: 0.04, inflationAssumption: 0.03 });
/** The RealState slice the parity mirrors read (C1): no cash accounts (the
 *  engine grows cash at 0%), one person retiring at 65. */
const DEF: EngineContext = {
  inflation: 0.03, defaultDrawdownTaxRate: undefined,
  defaultCashApy: null, cashAccountsWithBalances: [], persons: [{ targetRetirementAge: 65 }],
};
const CTX = (over: Partial<EngineContext> = {}): EngineContext => ({ ...DEF, ...over });
const scenarioOf = (payload: LeverPayload): Scenario => ({
  id: 1, name: 'S', isBaseline: false, color: '#4f86f7', lineStyle: 'solid',
  visible: true, isActive: false, sortOrder: 1, leverPayload: payload,
  createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z',
});

describe('lever classification (completeness ratchet)', () => {
  it('every LeverPayload key belongs to exactly ONE class — a new lever fails until classified', () => {
    const schemaKeys = Object.keys(LeverPayloadSchema.shape).sort();
    const classified = [...PLAN_LEVER_KEYS, ...ASSUMPTION_LEVER_KEYS].sort();
    expect(classified).toEqual(schemaKeys);
    expect(PLAN_LEVER_KEYS.filter((k) => (ASSUMPTION_LEVER_KEYS as readonly string[]).includes(k))).toEqual([]);
  });
});

describe('canonicalJson', () => {
  it('is key-order insensitive and byte-deterministic', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, null] } }))
      .toBe(canonicalJson({ a: { c: [3, null], d: 2 }, b: 1 }));
    expect(canonicalJson(undefined)).toBe('null');
  });
});

describe('engine-effective mirrors (parity with shipped resolvers)', () => {
  it('PARITY: effectiveSwrOf matches effectiveSwr across all three branches', () => {
    const withOverride = { ...P(), swrOverride: 0.035 };
    expect(effectiveSwrOf(withOverride, HH)).toBe(effectiveSwr(scenarioOf(withOverride), HH));
    expect(effectiveSwrOf(P(), HH)).toBe(effectiveSwr(scenarioOf(P()), HH));
    const hhZero = makeHousehold({ withdrawalRate: 0 });
    expect(effectiveSwrOf(P(), hhZero)).toBe(effectiveSwr(scenarioOf(P()), hhZero)); // 0.04 fallback
    expect(effectiveSwrOf(P(), hhZero)).toBe(0.04);
  });

  it('drawdown mirror: payload > 0 wins; explicit 0 falls through (engine.ts:662-672 recipe)', () => {
    expect(effectiveDrawdownTaxOf({ ...P(), effectiveDrawdownTaxRate: 0.22 }, { defaultDrawdownTaxRate: 0.1 })).toBe(0.22);
    expect(effectiveDrawdownTaxOf({ ...P(), effectiveDrawdownTaxRate: 0 }, { defaultDrawdownTaxRate: 0.1 })).toBe(0.1);
    expect(effectiveDrawdownTaxOf(P(), {})).toBe(0);
  });

  it('engine baseline inflation mirrors the inline slice (household EXCLUDED)', () => {
    // engine.ts:196-201 sets householdInflation: null on purpose — the mirror
    // must NOT consult the household (a fixture where household inflation is
    // set must still resolve scenario → settings → 0.03).
    expect(engineBaselineInflationOf(P(), { inflation: 0.025 })).toBe(0.025);
    expect(engineBaselineInflationOf({ ...P(), inflation: { defaultRate: 0.04, overrides: {} } }, { inflation: 0.025 })).toBe(0.04);
    expect(engineBaselineInflationOf(P(), {})).toBe(0.03);
  });
});

describe('computeAssumptionParity', () => {
  it('equal payloads → equal:true, zero differences', () => {
    const r = computeAssumptionParity(P(), P(), HH, DEF);
    expect(r.equal).toBe(true);
    expect(r.differences).toEqual([]);
  });

  it('one parameter off → exactly that one phrase, byte-exact (boundary pair per parameter)', () => {
    const base = P();
    const cases: [LeverPayload, string][] = [
      [{ ...base, returns: { ...base.returns, defaultRate: 0.055 } }, 'return 7% vs 5.5%'],
      [{ ...base, returns: { ...base.returns, overrides: { '2030': 0.02 } } }, 'year-specific return overrides differ'],
      // CR-P3 renders ENGINE-effective values (C1): DEF has no cash accounts, so the engine's cash APY is 0%.
      [{ ...base, returns: { ...base.returns, cashRate: 0.045 } }, 'cash rate 0% vs 4.5%'],
      // CR-P5 renders ENGINE-effective values (review MINOR 7): DEF.inflation
      // 0.03 is what the engine reads for the null-lever side.
      [{ ...base, inflation: { ...base.inflation, defaultRate: 0.04 } }, 'inflation 3% vs 4%'],
      [{ ...base, inflation: { ...base.inflation, overrides: { '2031': 0.05 } } }, 'year-specific inflation overrides differ'],
      [{ ...base, swrOverride: 0.035 }, 'withdrawal rate 4% vs 3.5%'],
      [{ ...base, withdrawalStrategy: 'sequential' }, 'withdrawal strategy proportional vs sequential'],
      // CR-P10 renders ENGINE-effective ages (C1): DEF's one person retires at 65.
      [{ ...base, retirementAgeOverride: 60 }, 'retirement age 65 vs 60'],
      // CR-P11 mode rename (R1): the rolling12m mode reads 'spending average'.
      // C2: P() is rolling12m now, so the CUSTOM side is the explicit one.
      [{ ...base, expenseSource: 'custom' }, 'expenses base spending average vs custom'],
      [{ ...base, annualLongTermGains: 12_000 }, 'long-term gains $0/yr vs $12,000/yr'],
      [{ ...base, annualQualifiedDividends: 2_500 }, 'qualified dividends $0/yr vs $2,500/yr'],
      [{ ...base, annualNonQualifiedDividends: 900 }, 'non-qualified dividends $0/yr vs $900/yr'],
      [{ ...base, gapAllocation: { taxAdvantaged: { mode: 'percent', value: 1, accountSplits: null }, brokerage: null } }, 'surplus routing differs'],
    ];
    for (const [b, phrase] of cases) {
      const r = computeAssumptionParity(base, b, HH, DEF);
      expect(r.equal).toBe(false);
      expect(r.differences).toEqual([phrase]);
    }
  });

  it('engine-inert differences stay silent: drawdown needs a sequential side; customMonthly needs a custom side', () => {
    const base = P();
    const dd = computeAssumptionParity(base, { ...base, effectiveDrawdownTaxRate: 0.22 }, HH, DEF);
    expect(dd.differences).toEqual([]); // both proportional → drawdown tax never applies
    const seqA = { ...base, withdrawalStrategy: 'sequential' as const };
    const seqB = { ...seqA, effectiveDrawdownTaxRate: 0.22 };
    const dd2 = computeAssumptionParity(seqA, seqB, HH, DEF);
    expect(dd2.differences).toEqual(['drawdown tax 0% vs 22%']);
    // customMonthly is inert unless a side actually uses the 'custom' source
    // (C2: P() is rolling12m, so the custom pair below is explicit).
    const rollingA = { ...base, expenseSource: 'rolling12m' as const };
    const rollingB = { ...rollingA, customMonthly: 5_000 };
    const cm = computeAssumptionParity(rollingA, rollingB, HH, DEF);
    expect(cm.differences).toEqual([]);
    const customA = { ...base, expenseSource: 'custom' as const };
    const customB = { ...customA, customMonthly: 5_000 };
    expect(computeAssumptionParity(customA, customB, HH, DEF).differences)
      .toEqual(['custom expenses $0/mo vs $5,000/mo']);
  });

  // Review MINOR 7 (CR-P5): the yardstick's clause 4 claims the PROJECTION's
  // assumptions differ. A null inflation lever against a household/Settings
  // default of the same number is the SAME number to the engine
  // (engine.ts:196-201), so the claim would be false.
  it('CR-P5 is engine-effective: a null lever against an equal engine default is SILENT', () => {
    const a = { ...P(), inflation: { defaultRate: 0.03, overrides: {} } };
    const r = computeAssumptionParity(a, P(), HH, CTX({ inflation: 0.03 }));
    expect(r.differences).toEqual([]);
    expect(r.equal).toBe(true);
  });

  it('CR-P5 names the EFFECTIVE values when they genuinely differ', () => {
    const a = { ...P(), inflation: { defaultRate: 0.03, overrides: {} } };
    expect(computeAssumptionParity(a, P(), HH, CTX({ inflation: 0.025 })).differences)
      .toEqual(['inflation 3% vs 2.5%']);
    // Both sides null, engine default present → the engine sees one number.
    expect(computeAssumptionParity(P(), P(), HH, CTX({ inflation: 0.025 })).differences).toEqual([]);
  });

  // Review MAJOR 4 (CR-P9 / CR-P12): the guards are "≥1 side", not "both
  // sides" — the parameter is engine-live on the side that uses it.
  it('CR-P9/CR-P12 fire at the ONE-side boundary (the engine-live side is named)', () => {
    const base = P();
    const seqA = { ...base, withdrawalStrategy: 'sequential' as const, effectiveDrawdownTaxRate: 0.22 };
    expect(computeAssumptionParity(seqA, base, HH, CTX({ defaultDrawdownTaxRate: 0.15 })).differences)
      .toEqual(['withdrawal strategy sequential vs proportional', 'drawdown tax 22% vs 15%']);
    const rollingA = { ...base, expenseSource: 'rolling12m' as const };
    const customB = { ...base, expenseSource: 'custom' as const, customMonthly: 5_000 };
    expect(computeAssumptionParity(rollingA, customB, HH, DEF).differences)
      .toEqual(['expenses base spending average vs custom', 'custom expenses $0/mo vs $5,000/mo']);
  });

  // Review MINOR 18: pct is toFixed(2) trimmed — toFixed(1) would render 7.3%.
  it('pct keeps two decimals (trimmed), never one', () => {
    const base = P();
    const b = { ...base, returns: { ...base.returns, defaultRate: 0.0725 } };
    expect(computeAssumptionParity(base, b, HH, DEF).differences).toEqual(['return 7% vs 7.25%']);
  });

  it('fixed phrase order mirrors the contract table when several differ', () => {
    const base = P();
    const b = { ...base, returns: { ...base.returns, defaultRate: 0.055 }, swrOverride: 0.035, retirementAgeOverride: 60 };
    const r = computeAssumptionParity(base, b, HH, DEF);
    expect(r.differences).toEqual([
      'return 7% vs 5.5%',
      'withdrawal rate 4% vs 3.5%',
      'retirement age 65 vs 60',
    ]);
  });

  it('inflation view feeds the deflator clause (effective + overrides flags)', () => {
    const b = { ...P(), inflation: { defaultRate: 0.04, overrides: { '2031': 0.05 } } };
    const r = computeAssumptionParity(P(), b, HH, CTX());
    expect(r.inflation).toEqual({ aEffective: 0.03, bEffective: 0.04, aHasOverrides: false, bHasOverrides: true });
  });

  it('a household-set inflation NEVER creates a difference the engine does not have', () => {
    const hhHighInflation = makeHousehold({ withdrawalRate: 0.04, inflationAssumption: 0.09 });
    const r = computeAssumptionParity(P(), P(), hhHighInflation, DEF);
    expect(r.equal).toBe(true);
    expect(r.inflation.aEffective).toBe(0.03);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C1 — CR-P3 (cash rate) and CR-P10 (retirement age) were the last two RAW
// comparisons in the parity table (review chip, 2026-09-01). The yardstick's
// clause 4 claims the PROJECTION's assumptions differ, so both now resolve
// the way the ENGINE resolves them and are checked against a projectScenario
// run — silence where the projection is byte-identical, the engine's own
// numbers where it is not.
// ─────────────────────────────────────────────────────────────────────────────
describe('engine-effective mirrors — C1 cash rate + retirement age', () => {
  const acct = (id: number, apyRate: number | null): Account =>
    ({ id, type: AccountType.ACCOUNT_SAVINGS, apyRate } as unknown as Account);

  it('engineCashApyOf builds the engine\'s two shims and calls the SHIPPED resolver (engine.ts:158-173)', () => {
    const accounts = [{ account: acct(1, 0.04), balance: 7_000 }, { account: acct(2, null), balance: 3_000 }];
    const withDefault = CTX({ cashAccountsWithBalances: accounts, defaultCashApy: 0.02 });
    const noDefault = CTX({ cashAccountsWithBalances: accounts, defaultCashApy: null });
    // 1. the lever wins outright
    const lever = { ...P(), returns: { ...P().returns, cashRate: 0.045 } };
    expect(engineCashApyOf(lever, withDefault)).toBe(0.045);
    expect(engineCashApyOf(lever, withDefault))
      .toBe(effectiveCashApy(scenarioOf(lever), accounts, { defaultCashApy: 0.02 } as AppSettings));
    // 2. balance-weighted: (7000×0.04 + 3000×0.02) / 10000 with the Settings default;
    //    the null-APY account reads 0 without it (settingsShim is null — engine.ts:166-168)
    expect(engineCashApyOf(P(), withDefault)).toBeCloseTo(0.034, 12);
    expect(engineCashApyOf(P(), noDefault)).toBeCloseTo(0.028, 12);
    expect(engineCashApyOf(P(), noDefault)).toBe(effectiveCashApy(scenarioOf(P()), accounts, null));
    // 3. no cash accounts → 0 (the engine then applies no cash growth at all)
    expect(engineCashApyOf(P(), CTX({ cashAccountsWithBalances: [] }))).toBe(0);
  });

  it('engineRetirementAgesOf mirrors engine.ts:517 PER PERSON (override ?? target ?? null)', () => {
    const persons = [{ targetRetirementAge: 65 }, { targetRetirementAge: 62 }];
    expect(engineRetirementAgesOf(P(), CTX({ persons }))).toEqual([65, 62]);
    expect(engineRetirementAgesOf({ ...P(), retirementAgeOverride: 60 }, CTX({ persons }))).toEqual([60, 60]);
    expect(engineRetirementAgesOf(P(), CTX({ persons: [{}] }))).toEqual([null]);
    expect(engineRetirementAgesOf({ ...P(), retirementAgeOverride: 60 }, CTX({ persons: [] }))).toEqual([]);
  });

  it('CR-P3 is engine-effective: a lever EQUAL to the weighted account APY is SILENT; unequal names both engine numbers', () => {
    const ctx = CTX({ cashAccountsWithBalances: [{ account: acct(1, 0.045), balance: 10_000 }] });
    const lever = (cashRate: number | null): LeverPayload => ({ ...P(), returns: { ...P().returns, cashRate } });
    expect(computeAssumptionParity(lever(null), lever(0.045), HH, ctx).differences).toEqual([]);
    expect(computeAssumptionParity(lever(null), lever(0.045), HH, ctx).equal).toBe(true);
    expect(computeAssumptionParity(lever(null), lever(0.03), HH, ctx).differences).toEqual(['cash rate 4.5% vs 3%']);
    // both null → one number to the engine, whatever it is
    expect(computeAssumptionParity(lever(null), lever(null), HH, ctx).differences).toEqual([]);
  });

  it('CR-P3 compares at the RENDERED precision — a floating-point ulp never names a difference (D-C1-1)', () => {
    // (7000×0.04 + 3000×0.02) / 10000 is EXACTLY 0.034 in IEEE754 (both
    // products land on the integers 280 and 60), so this pair agrees under
    // either comparison — it pins the PHRASE. The test below pins the
    // rounding RULE with a book that really does carry a ulp (review MAJOR 1).
    const ctx = CTX({
      cashAccountsWithBalances: [{ account: acct(1, 0.04), balance: 7_000 }, { account: acct(2, 0.02), balance: 3_000 }],
    });
    const typed = { ...P(), returns: { ...P().returns, cashRate: 0.034 } };
    expect(computeAssumptionParity(P(), typed, HH, ctx).differences).toEqual([]);
    const off = { ...P(), returns: { ...P().returns, cashRate: 0.0341 } };
    expect(computeAssumptionParity(P(), off, HH, ctx).differences).toEqual(['cash rate 3.4% vs 3.41%']);
  });

  it('CR-P3: a GENUINE sub-rendered-precision ulp stays silent — an exact-float compare would print "cash rate 1.3% vs 1.3%" (D-C1-1)', () => {
    // The real input path, on two ordinary savings accounts: 1000 @ 1% +
    // 1500 @ 1.5% weights to exactly 0.013, while the popover stores what the
    // user typed as Number('1.3') / 100 === 0.013000000000000001
    // (ReturnSchedulePopover.tsx:138; lever-types.ts:87 passes it through
    // unrounded). Both render '1.3%' — ONE rate to the projection.
    const ctx = CTX({
      cashAccountsWithBalances: [{ account: acct(1, 0.01), balance: 1_000 }, { account: acct(2, 0.015), balance: 1_500 }],
    });
    const typed = { ...P(), returns: { ...P().returns, cashRate: Number('1.3') / 100 } };
    // Precondition: the two engine-effective numbers really are UNEQUAL…
    expect(engineCashApyOf(P(), ctx)).toBe(0.013);
    expect(engineCashApyOf(typed, ctx)).not.toBe(engineCashApyOf(P(), ctx));
    // …and the yardstick is silent anyway, because the projection sees one rate.
    expect(computeAssumptionParity(P(), typed, HH, ctx).differences).toEqual([]);
    expect(computeAssumptionParity(P(), typed, HH, ctx).equal).toBe(true);
    // A difference AT the rendered precision is still named.
    const off = { ...P(), returns: { ...P().returns, cashRate: 0.0131 } };
    expect(computeAssumptionParity(P(), off, HH, ctx).differences).toEqual(['cash rate 1.3% vs 1.31%']);
  });

  it('CR-P10 is engine-effective: an override equal to EVERY person\'s target is silent; per-person ages join " / "', () => {
    const two = CTX({ persons: [{ targetRetirementAge: 65 }, { targetRetirementAge: 62 }] });
    const over = (age: number | null): LeverPayload => ({ ...P(), retirementAgeOverride: age });
    expect(computeAssumptionParity(over(null), over(65), HH, two).differences)
      .toEqual(['retirement age 65 / 62 vs 65 / 65']);
    const same = CTX({ persons: [{ targetRetirementAge: 65 }, { targetRetirementAge: 65 }] });
    expect(computeAssumptionParity(over(null), over(65), HH, same).differences).toEqual([]);
    expect(computeAssumptionParity(over(null), over(65), HH, same).equal).toBe(true);
    expect(computeAssumptionParity(over(null), over(60), HH, same).differences)
      .toEqual(['retirement age 65 / 65 vs 60 / 60']);
  });

  // Review MINOR 7: the silence here is NOT carried by a length guard — the
  // one that used to sit in front of this clause was an equivalent mutant
  // (`[].some(...)` is already false) commented as if it were load-bearing.
  // The pin is unchanged; only the mechanism named in the source is.
  it('CR-P10 is engine-inert without persons on file (the per-person map is empty); a target-less person renders "default"', () => {
    const over = (age: number | null): LeverPayload => ({ ...P(), retirementAgeOverride: age });
    expect(computeAssumptionParity(over(null), over(60), HH, CTX({ persons: [] })).differences).toEqual([]);
    expect(computeAssumptionParity(over(null), over(60), HH, CTX({ persons: [{}] })).differences)
      .toEqual(['retirement age default vs 60']);
  });

  it('a sparse EngineContext throws instead of silently reporting "engine-inert" (D-C1-2)', () => {
    expect(() => computeAssumptionParity(P(), P(), HH, { inflation: 0.03 } as unknown as EngineContext)).toThrow();
  });

  // ── ENGINE-RUN parity: the mirror's verdict against projectScenario's own output ──
  // A deliberately SPARSE RealState (tests sit outside tsconfig's `include`;
  // the engine `?? []`s / `?? 0`s every field left out — the retirement.test.ts
  // / engine-compounding.test.ts fixture idiom). No income tax: a no-tax
  // schedule is a single ZERO-RATE bracket, never [] (house gotcha).
  const ZERO_TAX = {
    federal: [{ min: 0, max: null, rate: 0 }],
    state: [], city: null,
    standardDeduction: { federal: 0, state: 0, city: 0 },
  };
  const sparseReal = (over: Partial<RealState>): RealState => ({
    accounts: [], holdings: [], loans: [], loanPayments: [],
    household: {
      id: 1, filingStatus: 'SINGLE', state: 'TX', city: null, monthlyExpenseBaseline: 0,
      withdrawalRate: 0.04, inflationAssumption: 0.025, growthScenarios: [],
    } as unknown as Household,
    persons: [],
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 0,
    initialInvestmentsByAccount: {},
    cashAccountsWithBalances: [],
    defaults: { inflation: 0, returnRate: 0, defaultCashApy: null, defaultDrawdownTaxRate: null },
    startISO: '2026-05',
    taxBrackets: ZERO_TAX,
    ...over,
  } as unknown as RealState);

  it('ENGINE PARITY (CR-P3): a null cash lever against the engine\'s own weighted APY projects the SAME cash — and the mirror says so', () => {
    const real = sparseReal({
      initialCash: 10_000,
      cashAccountsWithBalances: [{ account: acct(99, 0.05), balance: 10_000 }],
    });
    const ctx: EngineContext = {
      inflation: 0, defaultCashApy: null,
      cashAccountsWithBalances: real.cashAccountsWithBalances, persons: [],
    };
    const noGrowth = (cashRate: number | null): LeverPayload =>
      ({ ...P(), returns: { ...P().returns, defaultRate: 0, cashRate } });
    const H = { startISO: '2026-05', months: 13 };
    const nullLever = projectScenario(real, noGrowth(null), H);
    const sameRate = projectScenario(real, noGrowth(0.05), H);
    const lowerRate = projectScenario(real, noGrowth(0.03), H);
    expect(nullLever[12].cash).toBeCloseTo(10_500, 0);                    // the engine really grows cash at 5%
    expect(sameRate[12].cash).toBeCloseTo(nullLever[12].cash, 8);         // an equal lever changes nothing…
    expect(computeAssumptionParity(noGrowth(null), noGrowth(0.05), HH, ctx).differences).toEqual([]); // …so parity is silent
    expect(lowerRate[12].cash).toBeLessThan(nullLever[12].cash);          // a real difference…
    expect(computeAssumptionParity(noGrowth(null), noGrowth(0.03), HH, ctx).differences)
      .toEqual(['cash rate 5% vs 3%']);                                    // …is named with the engine's numbers
  });

  it('ENGINE PARITY (CR-P10): an override equal to the person\'s own target changes nothing the engine does — silent; a different age is named', () => {
    // Born 1981-05-15, target 50 → salary stops at 2031-06 (month 61 from 2026-05;
    // ageAtMonth('1981-05-15','2031-06') = 50 — retirement.test.ts).
    const person = {
      id: 1, householdId: 1, name: 'P1', dateOfBirth: '1981-05-15',
      targetRetirementAge: 50, annualSalaryPretax: 135_000,
    } as unknown as Person;
    const real = sparseReal({ persons: [person] });
    const ctx: EngineContext = { inflation: 0, cashAccountsWithBalances: [], persons: real.persons };
    const withAge = (retirementAgeOverride: number | null): LeverPayload => ({ ...P(), retirementAgeOverride });
    const H = { startISO: '2026-05', months: 120 };
    const income = (states: MonthlyState[]): number[] => states.map((s) => s.incomeAfterTax);
    const target = projectScenario(real, withAge(null), H);
    const same = projectScenario(real, withAge(50), H);
    const later = projectScenario(real, withAge(55), H);
    expect(income(same)).toEqual(income(target));                                       // month for month
    expect(computeAssumptionParity(withAge(null), withAge(50), HH, ctx).differences).toEqual([]);
    expect(target[61].incomeAfterTax).toBe(0);                                          // retired at 50
    expect(later[61].incomeAfterTax).toBeGreaterThan(0);                                // still earning at 50 under 55
    expect(income(later)).not.toEqual(income(target));
    expect(computeAssumptionParity(withAge(null), withAge(55), HH, ctx).differences)
      .toEqual(['retirement age 50 vs 55']);
  });
});

describe('buildLeverDiff (FULL LeverPayload coverage — D-W3-8)', () => {
  const LOANS = { 7: 'Car loan' };

  it('empty vs empty → isEmpty', () => {
    const d = buildLeverDiff(P(), P(), { loanNames: LOANS });
    expect(d).toEqual({ onlyInA: [], onlyInB: [], changed: [], isEmpty: true });
  });

  it('PARITY: overlapping lever phrases match summarizeLevers byte-for-byte on a shared fixture', () => {
    const payload: LeverPayload = {
      ...P(),
      extraLoanPayments: [{ loanId: 7, extraMonthly: 300 }],
      lumpSums: [{ when: '2026-09-01', amount: 10_000, destination: 'investments' }],
      contributions: [{ startMonth: 0, endMonth: null, monthlyAmount: 500, allocation: null }],
    };
    const summary = summarizeLevers(payload, { loanNames: LOANS });
    const d = buildLeverDiff(payload, P(), { loanNames: LOANS });
    for (const phrase of d.onlyInA) {
      const bare = phrase.replace(' (details differ)', '');
      expect(summary).toContain(bare);
    }
    expect(d.onlyInA).toEqual([
      '+$300/mo on Car loan (Always)',
      'Lump sum 2026-09: +$10,000 (investments)',
      'Contribute +$500/mo (Y1-∞)',
    ]);
    expect(d.onlyInB).toEqual([]);
  });

  // Review MINOR 19: the D-W3-P8 mirror is byte-identical today, but the
  // shared fixture used only integers — rounding drift between the two copies
  // would have shown up first on a fractional and a ≥1000 amount.
  it('PARITY: fractional and ≥1000 amounts format identically in both copies', () => {
    const payload: LeverPayload = {
      ...P(),
      extraLoanPayments: [{ loanId: 7, extraMonthly: 1234.5 }],
      lumpSums: [{ when: '2026-09-01', amount: 12.25, destination: 'cash' }],
    };
    const summary = summarizeLevers(payload, { loanNames: LOANS });
    const d = buildLeverDiff(payload, P(), { loanNames: LOANS });
    expect(d.onlyInA).toEqual([
      '+$1,234.5/mo on Car loan (Always)',
      'Lump sum 2026-09: +$12.25 (cash)',
    ]);
    for (const phrase of d.onlyInA) expect(summary).toContain(phrase);
  });

  it('expense periods and windowed loan payments mirror the shipped phrase shapes', () => {
    const payload: LeverPayload = {
      ...P(),
      extraLoanPayments: [{ loanId: 7, extraMonthly: 300, start: '2027-01-01' }],
      expensePeriods: [{ start: '2027-06-01', monthlyDelta: -250, durationMonths: 12, label: 'Downsize' }],
    };
    const summary = summarizeLevers(payload, { loanNames: LOANS });
    const d = buildLeverDiff(payload, P(), { loanNames: LOANS });
    expect(d.onlyInA).toEqual([
      '+$300/mo on Car loan (2027-01 → ∞)',
      'Expenses 2027-06 × 12mo: -$250/mo (Downsize)',
    ]);
    for (const phrase of d.onlyInA) expect(summary).toContain(phrase);
  });

  it('an unnamed loan falls back to the shipped "Loan #{id}" form', () => {
    const payload: LeverPayload = { ...P(), extraLoanPayments: [{ loanId: 42, extraMonthly: 75 }] };
    const summary = summarizeLevers(payload, { loanNames: {} });
    const d = buildLeverDiff(payload, P(), { loanNames: {} });
    expect(d.onlyInA).toEqual(['+$75/mo on Loan #42 (Always)']);
    expect(summary).toContain('+$75/mo on Loan #42 (Always)');
  });

  it('previously unreported fields cannot hide: an income event and a raise both surface', () => {
    const a = P();
    const b: LeverPayload = {
      ...P(),
      income: {
        ...P().income,
        perPerson: [
          { annualRaiseRate: 0.03, events: [{ when: '2027-03-01', type: 'sabbatical', durationMonths: 6 }] },
        ],
      },
    };
    const d = buildLeverDiff(a, b, { loanNames: {} });
    expect(d.onlyInB).toEqual(['Income event 2027-03: sabbatical 6mo']);
    expect(d.changed).toEqual(['Annual raises: 0% vs 3%']);
    expect(d.changed.length + d.onlyInB.length).toBeGreaterThanOrEqual(1);
    expect(d.isEmpty).toBe(false);
  });

  it('income-event suffixes cover every discriminated type; the person suffix needs two people', () => {
    const b: LeverPayload = {
      ...P(),
      income: {
        perPerson: [
          { annualRaiseRate: 0, events: [{ when: '2027-03-01', type: 'raise', deltaAmount: 5_000 }] },
          { annualRaiseRate: 0, events: [{ when: '2028-01-01', type: 'promotion', newSalary: 150_000 }] },
        ],
      },
    };
    const a: LeverPayload = { ...P(), income: { perPerson: [{ annualRaiseRate: 0, events: [] }, { annualRaiseRate: 0, events: [] }] } };
    const d = buildLeverDiff(a, b, { loanNames: {} });
    expect(d.onlyInB).toEqual([
      'Income event 2027-03: raise +$5,000 (person 1)',
      'Income event 2028-01: promotion to $150,000/yr (person 2)',
    ]);
  });

  // Review MINOR 5: CR-MD2 joins per-person raises with ' / ' (the
  // lever-summary.ts:58-60 idiom) — the only two-person fixture had equal
  // raises, so no changed line was produced and ', ' survived.
  it('CR-MD2: per-person raises join with " / ", matching the shipped summary idiom', () => {
    const withRaises = (rates: number[]): LeverPayload => ({
      ...P(), income: { perPerson: rates.map((r) => ({ annualRaiseRate: r, events: [] })) },
    });
    const d = buildLeverDiff(withRaises([0.03, 0.02]), withRaises([0, 0]), { loanNames: {} });
    expect(d.changed).toEqual(['Annual raises: 3% / 2% vs 0% / 0%']);
    expect(summarizeLevers(withRaises([0.03, 0.02]), { loanNames: {} })).toContain('Raises: 3% / 2%');
  });

  it('CR-L6: same phrase, different canonical JSON → both sides marked "(details differ)"', () => {
    const a: LeverPayload = { ...P(), contributions: [{ startMonth: 0, endMonth: null, monthlyAmount: 500, allocation: { '1': 1 } }] };
    const b: LeverPayload = { ...P(), contributions: [{ startMonth: 0, endMonth: null, monthlyAmount: 500, allocation: { '2': 1 } }] };
    const d = buildLeverDiff(a, b, { loanNames: {} });
    expect(d.onlyInA).toHaveLength(1);
    expect(d.onlyInA[0].endsWith(' (details differ)')).toBe(true);
    expect(d.onlyInB[0]).toBe(d.onlyInA[0]);
  });

  it('PROPERTY: byte-identical output for independently constructed equal inputs', () => {
    const mk = (): LeverPayload => ({ ...P(), extraLoanPayments: [{ loanId: 7, extraMonthly: 300 }] });
    expect(JSON.stringify(buildLeverDiff(mk(), P(), { loanNames: LOANS })))
      .toBe(JSON.stringify(buildLeverDiff(mk(), P(), { loanNames: LOANS })));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Smoke defect D1 (main 6ef73e41, 2026-09-02): "Annual raises: 0% vs 0% / 0%"
// rendered as the ONLY main difference between a lever-identical twin and its
// source, because the raises comparison keyed off the SHAPE of
// income.perPerson (one entry vs two after the Income dialog normalizes it)
// rather than the per-person VALUES.
//
// The engine resolves a missing perPerson entry as
//   payload.income.perPerson[idx] ?? payload.income.perPerson[0]      (engine.ts:515)
// so ONE entry models the same raises AND the same income events for every
// person that the same entry repeated does. Both sides are aligned to that
// rule before anything is compared; a shape-only difference is not a
// difference the projected lines have, and must never render as one.
// ─────────────────────────────────────────────────────────────────────────────
describe('buildLeverDiff — income shape is not a difference (smoke D1)', () => {
  const plans = (...pp: { annualRaiseRate: number; events?: LeverPayload['income']['perPerson'][number]['events'] }[]): LeverPayload => ({
    ...P(),
    income: { perPerson: pp.map((p) => ({ annualRaiseRate: p.annualRaiseRate, events: p.events ?? [] })) },
  });
  const RAISE_EVT = { when: '2027-03-01', type: 'raise', deltaAmount: 5_000 } as const;

  it('the smoke repro: single-entry raise 0 vs per-person [0, 0] renders NO raises line', () => {
    const one = plans({ annualRaiseRate: 0 });
    const two = plans({ annualRaiseRate: 0 }, { annualRaiseRate: 0 });
    const d = buildLeverDiff(one, two, { loanNames: {} });
    expect(d.changed).toEqual([]);
    expect(d.isEmpty).toBe(true);
    // ...and the two payloads are NOT canonical-JSON equal, so the BL-5
    // "identical" rung stays out of reach (pinned in plan-review.test.ts).
    expect(canonicalJson(one)).not.toBe(canonicalJson(two));
  });

  it('the missing entry is filled from perPerson[0] — never from an invented 0%', () => {
    // A padding mutant that invents `{annualRaiseRate: 0}` renders
    // 'Annual raises: 3% / 0% vs 3% / 3%'; the engine's own fallback renders
    // nothing at all.
    const one = plans({ annualRaiseRate: 0.03 });
    const two = plans({ annualRaiseRate: 0.03 }, { annualRaiseRate: 0.03 });
    expect(buildLeverDiff(one, two, { loanNames: {} }).changed).toEqual([]);
  });

  it('a GENUINE per-person rate difference still renders, in the CR-MD2 format', () => {
    const d = buildLeverDiff(
      plans({ annualRaiseRate: 0.03 }, { annualRaiseRate: 0 }),
      plans({ annualRaiseRate: 0.03 }, { annualRaiseRate: 0.02 }),
      { loanNames: {} },
    );
    expect(d.changed).toEqual(['Annual raises: 3% / 0% vs 3% / 2%']);
    expect(d.isEmpty).toBe(false);
  });

  it('a genuine difference UNDER a shape difference renders both sides aligned', () => {
    // One entry at 3% vs [5%, 3%]: the engine gives person 2 the 3% entry on
    // the left, so the honest rendering is the aligned pair — not '3% vs 5% / 3%'.
    const d = buildLeverDiff(
      plans({ annualRaiseRate: 0.03 }),
      plans({ annualRaiseRate: 0.05 }, { annualRaiseRate: 0.03 }),
      { loanNames: {} },
    );
    expect(d.changed).toEqual(['Annual raises: 3% / 3% vs 5% / 3%']);
  });

  it('shape alone cannot make an income EVENT look like an extra move', () => {
    const one = plans({ annualRaiseRate: 0, events: [RAISE_EVT] });
    const two = plans({ annualRaiseRate: 0, events: [RAISE_EVT] }, { annualRaiseRate: 0, events: [RAISE_EVT] });
    const d = buildLeverDiff(one, two, { loanNames: {} });
    expect(d.onlyInA).toEqual([]);
    expect(d.onlyInB).toEqual([]);
    expect(d.isEmpty).toBe(true);
  });

  it('an event the engine really does drop for person 2 still surfaces', () => {
    // Left: one entry carrying the event ⇒ BOTH people get it. Right: person 2
    // has their own empty plan ⇒ only person 1 gets it. A real difference.
    const d = buildLeverDiff(
      plans({ annualRaiseRate: 0, events: [RAISE_EVT] }),
      plans({ annualRaiseRate: 0, events: [RAISE_EVT] }, { annualRaiseRate: 0 }),
      { loanNames: {} },
    );
    expect(d.onlyInA).toEqual(['Income event 2027-03: raise +$5,000 (person 2)']);
    expect(d.onlyInB).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C1 — the engine reads income.perPerson[idx] for idx < real.persons.length
// ONLY (engine.ts:515), falling back to entry 0. With ONE person on file a
// differing SECOND entry is never read — reporting it was a difference the
// projected lines don't have (W3 review chip). The page passes the person
// count; without it (no engine context) the entry-width comparison stands.
// ─────────────────────────────────────────────────────────────────────────────
describe('buildLeverDiff — personCount is the engine\'s read width (C1)', () => {
  const plans = (...pp: { annualRaiseRate: number; events?: LeverPayload['income']['perPerson'][number]['events'] }[]): LeverPayload => ({
    ...P(),
    income: { perPerson: pp.map((p) => ({ annualRaiseRate: p.annualRaiseRate, events: p.events ?? [] })) },
  });
  const RAISE_EVT = { when: '2027-03-01', type: 'raise', deltaAmount: 5_000 } as const;

  it('one person on file: a differing SECOND entry is engine-inert — no raises line, no event', () => {
    const a = plans({ annualRaiseRate: 0.03 });
    const b = plans({ annualRaiseRate: 0.03 }, { annualRaiseRate: 0.05, events: [RAISE_EVT] });
    const d = buildLeverDiff(a, b, { loanNames: {}, personCount: 1 });
    expect(d).toEqual({ onlyInA: [], onlyInB: [], changed: [], isEmpty: true });
  });

  it('two persons on file: the same second entry IS a difference, in the frozen formats', () => {
    const a = plans({ annualRaiseRate: 0.03 });
    const b = plans({ annualRaiseRate: 0.03 }, { annualRaiseRate: 0.05, events: [RAISE_EVT] });
    const d = buildLeverDiff(a, b, { loanNames: {}, personCount: 2 });
    expect(d.changed).toEqual(['Annual raises: 3% / 3% vs 3% / 5%']);
    expect(d.onlyInB).toEqual(['Income event 2027-03: raise +$5,000 (person 2)']);
    expect(d.isEmpty).toBe(false);
  });

  it('one entry, two persons on file: the entry is read for BOTH persons (engine.ts:515), so its event renders per person', () => {
    const d = buildLeverDiff(P(), plans({ annualRaiseRate: 0, events: [RAISE_EVT] }), { loanNames: {}, personCount: 2 });
    expect(d.onlyInB).toEqual([
      'Income event 2027-03: raise +$5,000 (person 1)',
      'Income event 2027-03: raise +$5,000 (person 2)',
    ]);
  });

  it('zero persons on file: income levers are inert', () => {
    const d = buildLeverDiff(P(), plans({ annualRaiseRate: 0.05, events: [RAISE_EVT] }), { loanNames: {}, personCount: 0 });
    expect(d.isEmpty).toBe(true);
  });

  it('omitted personCount keeps the entry-width comparison (no engine context)', () => {
    const a = plans({ annualRaiseRate: 0.03 });
    const b = plans({ annualRaiseRate: 0.03 }, { annualRaiseRate: 0.05 });
    expect(buildLeverDiff(a, b, { loanNames: {} }).changed).toEqual(['Annual raises: 3% / 3% vs 3% / 5%']);
  });

  it('PROPERTY: byte-identical output for independently constructed equal inputs (with personCount)', () => {
    const mk = () => plans({ annualRaiseRate: 0.03 }, { annualRaiseRate: 0.05 });
    expect(JSON.stringify(buildLeverDiff(mk(), P(), { loanNames: {}, personCount: 2 })))
      .toBe(JSON.stringify(buildLeverDiff(mk(), P(), { loanNames: {}, personCount: 2 })));
  });
});
