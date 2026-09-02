import { describe, it, expect } from 'vitest';
import { emptyLeverPayload, LeverPayloadSchema, effectiveSwr } from '@/lib/scenarios';
import { summarizeLevers } from '@/lib/whatif/lever-summary';
import {
  PLAN_LEVER_KEYS, ASSUMPTION_LEVER_KEYS, canonicalJson,
  computeAssumptionParity, buildLeverDiff, effectiveSwrOf, effectiveDrawdownTaxOf,
  engineBaselineInflationOf,
} from '@/lib/whatif/lever-diff';
import type { LeverPayload } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';
import { makeHousehold } from '../../factories';

const P = () => emptyLeverPayload();
const HH = makeHousehold({ withdrawalRate: 0.04, inflationAssumption: 0.03 });
const DEF = { inflation: 0.03, defaultDrawdownTaxRate: undefined };

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
    const scenarioOf = (payload: LeverPayload): Scenario => ({
      id: 1, name: 'S', isBaseline: false, color: '#4f86f7', lineStyle: 'solid',
      visible: true, isActive: false, sortOrder: 1, leverPayload: payload,
      createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z',
    });
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
      [{ ...base, returns: { ...base.returns, cashRate: 0.045 } }, 'cash rate default APY vs 4.5%'],
      // CR-P5 renders ENGINE-effective values (review MINOR 7): DEF.inflation
      // 0.03 is what the engine reads for the null-lever side.
      [{ ...base, inflation: { ...base.inflation, defaultRate: 0.04 } }, 'inflation 3% vs 4%'],
      [{ ...base, inflation: { ...base.inflation, overrides: { '2031': 0.05 } } }, 'year-specific inflation overrides differ'],
      [{ ...base, swrOverride: 0.035 }, 'withdrawal rate 4% vs 3.5%'],
      [{ ...base, withdrawalStrategy: 'sequential' }, 'withdrawal strategy proportional vs sequential'],
      [{ ...base, retirementAgeOverride: 60 }, 'retirement age default vs 60'],
      [{ ...base, expenseSource: 'rolling12m' }, 'expenses base custom vs 12-month average'],
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
    // customMonthly is inert unless a side actually uses the 'custom' source.
    const rollingA = { ...base, expenseSource: 'rolling12m' as const };
    const rollingB = { ...rollingA, customMonthly: 5_000 };
    const cm = computeAssumptionParity(rollingA, rollingB, HH, DEF);
    expect(cm.differences).toEqual([]);
    const customB = { ...base, customMonthly: 5_000 };
    expect(computeAssumptionParity(base, customB, HH, DEF).differences)
      .toEqual(['custom expenses $0/mo vs $5,000/mo']);
  });

  // Review MINOR 7 (CR-P5): the yardstick's clause 4 claims the PROJECTION's
  // assumptions differ. A null inflation lever against a household/Settings
  // default of the same number is the SAME number to the engine
  // (engine.ts:196-201), so the claim would be false.
  it('CR-P5 is engine-effective: a null lever against an equal engine default is SILENT', () => {
    const a = { ...P(), inflation: { defaultRate: 0.03, overrides: {} } };
    const r = computeAssumptionParity(a, P(), HH, { inflation: 0.03 });
    expect(r.differences).toEqual([]);
    expect(r.equal).toBe(true);
  });

  it('CR-P5 names the EFFECTIVE values when they genuinely differ', () => {
    const a = { ...P(), inflation: { defaultRate: 0.03, overrides: {} } };
    expect(computeAssumptionParity(a, P(), HH, { inflation: 0.025 }).differences)
      .toEqual(['inflation 3% vs 2.5%']);
    // Both sides null, engine default present → the engine sees one number.
    expect(computeAssumptionParity(P(), P(), HH, { inflation: 0.025 }).differences).toEqual([]);
  });

  // Review MAJOR 4 (CR-P9 / CR-P12): the guards are "≥1 side", not "both
  // sides" — the parameter is engine-live on the side that uses it.
  it('CR-P9/CR-P12 fire at the ONE-side boundary (the engine-live side is named)', () => {
    const base = P();
    const seqA = { ...base, withdrawalStrategy: 'sequential' as const, effectiveDrawdownTaxRate: 0.22 };
    expect(computeAssumptionParity(seqA, base, HH, { inflation: 0.03, defaultDrawdownTaxRate: 0.15 }).differences)
      .toEqual(['withdrawal strategy sequential vs proportional', 'drawdown tax 22% vs 15%']);
    const rollingA = { ...base, expenseSource: 'rolling12m' as const };
    const customB = { ...base, expenseSource: 'custom' as const, customMonthly: 5_000 };
    expect(computeAssumptionParity(rollingA, customB, HH, DEF).differences)
      .toEqual(['expenses base 12-month average vs custom', 'custom expenses $0/mo vs $5,000/mo']);
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
      'retirement age default vs 60',
    ]);
  });

  it('inflation view feeds the deflator clause (effective + overrides flags)', () => {
    const b = { ...P(), inflation: { defaultRate: 0.04, overrides: { '2031': 0.05 } } };
    const r = computeAssumptionParity(P(), b, HH, { inflation: 0.03 });
    expect(r.inflation).toEqual({ aEffective: 0.03, bEffective: 0.04, aHasOverrides: false, bHasOverrides: true });
  });

  it('a household-set inflation NEVER creates a difference the engine does not have', () => {
    const hhHighInflation = makeHousehold({ withdrawalRate: 0.04, inflationAssumption: 0.09 });
    const r = computeAssumptionParity(P(), P(), hhHighInflation, DEF);
    expect(r.equal).toBe(true);
    expect(r.inflation.aEffective).toBe(0.03);
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
