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
      [{ ...base, inflation: { ...base.inflation, defaultRate: 0.04 } }, 'inflation default vs 4%'],
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
