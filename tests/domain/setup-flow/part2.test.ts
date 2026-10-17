import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  nameForRole, prefillBenefits, prefillPay, savePay, saveRetirement, saveBenefits, type BenefitsValues,
} from '@/domain/setup-flow/steps/part2';
import { usePersonsStore } from '@/stores/persons-store';
import { defaultProgressV2, type SetupProgressV2 } from '@/lib/setup-progress';
import { DEFAULT_PERSON } from '@/lib/entity-scaffolds';
import { makeHousehold, makePerson } from '../../factories';
import type { FlowCtx } from '@/domain/setup-flow/types';

const personsUpdate = vi.fn(async () => {});
const personsCreate = vi.fn(async () => 11);

function ctxWith(overrides: Partial<FlowCtx> = {}): FlowCtx {
  return {
    household: makeHousehold(), persons: [], dependents: [], accounts: [], properties: [],
    housingPayments: [], vehicles: [], vehicleLeases: [], equityGrants: [], loans: [],
    transactions: [], goals: [], progress: defaultProgressV2(), todayIso: '2026-08-09',
    ...overrides,
  };
}
const progressWith = (patch: Partial<SetupProgressV2>): SetupProgressV2 => ({
  ...defaultProgressV2(), ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  usePersonsStore.setState({
    persons: [], isLoading: false, error: null,
    update: personsUpdate, create: personsCreate, load: async () => {},
  } as never);
});

describe('part2 save mappers', () => {
  it('nameForRole: bound name → draft name → mechanical fallback', () => {
    expect(nameForRole(ctxWith({ persons: [makePerson({ id: 1, name: 'Alex' })] }), 'you')).toBe('Alex');
    expect(nameForRole(ctxWith({
      progress: progressWith({ drafts: { partner: { name: 'Sam', dateOfBirth: '1991-02-03' } } }),
    }), 'partner')).toBe('Sam');
    expect(nameForRole(ctxWith(), 'partner')).toBe('your partner');
  });

  it('savePay unbound: NO create — the patch parks as a pay draft (HOURLY zeroes salary)', async () => {
    const r = await savePay('you', {
      employmentType: 'HOURLY', annualSalaryPretax: '',
      hourlyRate: 31.25, regularHoursPerWeek: '38', otThresholdHoursPerWeek: null,
    }, ctxWith());
    expect(personsCreate).not.toHaveBeenCalled();
    const updated = r.ok && r.progressUpdate ? r.progressUpdate(defaultProgressV2()) : null;
    expect(updated?.drafts.pay?.you).toEqual({
      employmentType: 'HOURLY', annualSalaryPretax: 0,
      hourlyRate: 31.25, regularHoursPerWeek: 38, otThresholdHoursPerWeek: null,
    });
  });

  it('savePay bound: updates through the shared employment contract', async () => {
    const p = makePerson({ id: 7, employmentType: 'SALARY_NO_OT', regularHoursPerWeek: 37.5 });
    await savePay('you', {
      employmentType: 'SALARY_NO_OT', annualSalaryPretax: '95000',
      hourlyRate: null, regularHoursPerWeek: '', otThresholdHoursPerWeek: null,
    }, ctxWith({ persons: [p] }));
    expect(personsUpdate).toHaveBeenCalledWith(7, {
      employmentType: 'SALARY_NO_OT', annualSalaryPretax: 95000,
      hourlyRate: null, regularHoursPerWeek: 37.5, otThresholdHoursPerWeek: null,
    });
  });

  it('savePay validation failure returns ok:false and writes nothing', async () => {
    const r = await savePay('you', {
      employmentType: 'SALARY_NO_OT', annualSalaryPretax: '',
      hourlyRate: null, regularHoursPerWeek: '', otThresholdHoursPerWeek: null,
    }, ctxWith());
    expect(r).toEqual({ ok: false });
    expect(personsUpdate).not.toHaveBeenCalled();
  });

  it('saveRetirement unbound = THE one-shot create: real answers over the scaffold, then binding + draft cleanup', async () => {
    const ctx = ctxWith({
      progress: progressWith({
        drafts: {
          you: { name: 'Alex Rivera', dateOfBirth: '1990-05-01' },
          pay: { you: {
            employmentType: 'SALARY_NO_OT', annualSalaryPretax: 95000,
            hourlyRate: null, regularHoursPerWeek: 40, otThresholdHoursPerWeek: null,
          } },
        },
      }),
    });
    const r = await saveRetirement('you', 67, ctx);
    expect(personsCreate).toHaveBeenCalledTimes(1);
    expect(personsCreate).toHaveBeenCalledWith({
      ...DEFAULT_PERSON,               // scaffold for every un-asked default
      name: 'Alex Rivera',
      dateOfBirth: '1990-05-01',
      employmentType: 'SALARY_NO_OT',
      annualSalaryPretax: 95000,
      hourlyRate: null,
      regularHoursPerWeek: 40,
      otThresholdHoursPerWeek: null,
      targetRetirementAge: 67,
    });
    const updated = r.ok && r.progressUpdate ? r.progressUpdate(ctx.progress) : null;
    expect(updated?.bindings.you).toBe(11);
    expect(updated?.drafts.you).toBeUndefined();
    expect(updated?.drafts.pay?.you).toBeUndefined();
  });

  it('saveRetirement bound: a plain update; rejects out-of-range ages', async () => {
    const p = makePerson({ id: 7 });
    await saveRetirement('you', 55, ctxWith({ persons: [p] }));
    expect(personsUpdate).toHaveBeenCalledWith(7, { targetRetirementAge: 55 });
    expect(await saveRetirement('you', 29, ctxWith({ persons: [p] }))).toEqual({ ok: false });
    expect(await saveRetirement('you', 91, ctxWith({ persons: [p] }))).toEqual({ ok: false });
  });

  it('saveBenefits: percent-twin conversion (6 → 0.06) and entered-fields-only writes', async () => {
    const p = makePerson({ id: 7 });
    await saveBenefits('you', {
      pct401k: 6, hsaContributes: true, hsaEligible: true, hsaMonthly: 250, premiumMonthly: null,
    }, ctxWith({ persons: [p] }));
    expect(personsUpdate).toHaveBeenCalledWith(7, {
      pretax401kPct: 0.06, hsaEligible: true, hsaMonthlyContribution: 250,
    });
    personsUpdate.mockClear();
    // nothing entered → writes NOTHING
    const r = await saveBenefits('you', {
      pct401k: null, hsaContributes: null, hsaEligible: false, hsaMonthly: null, premiumMonthly: null,
    }, ctxWith({ persons: [p] }));
    expect(r.ok).toBe(true);
    expect(personsUpdate).not.toHaveBeenCalled();
  });

  it('m4: an explicit HSA "No" writes the honest zero over a saved contribution', async () => {
    const p = makePerson({ id: 7, hsaMonthlyContribution: 250 });
    await saveBenefits('you', {
      pct401k: null, hsaContributes: false, hsaEligible: true, hsaMonthly: null, premiumMonthly: null,
    }, ctxWith({ persons: [p] }));
    expect(personsUpdate).toHaveBeenCalledWith(7, { hsaMonthlyContribution: 0 });
    personsUpdate.mockClear();
    // Explicit No with nothing stored stays a no-op (entered-fields-only).
    const clean = makePerson({ id: 8, hsaMonthlyContribution: 0 });
    const r = await saveBenefits('you', {
      pct401k: null, hsaContributes: false, hsaEligible: false, hsaMonthly: null, premiumMonthly: null,
    }, ctxWith({ persons: [clean] }));
    expect(r.ok).toBe(true);
    expect(personsUpdate).not.toHaveBeenCalled();
  });
});

describe('2a — an untouched Next writes nothing to a bound person (v1.8.0 O3, CL-O3-2, D-O3-15)', () => {
  // The shell saves every step on Next, dirty or not. An untouched Next
  // re-submits the bound row's own prefill, so it now writes nothing: a
  // legacy Hourly row (written before the shared contract) keeps its stored
  // salary. Any real edit still saves through the one employment contract.
  const LEGACY_HOURLY = makePerson({
    id: 7, employmentType: 'HOURLY', annualSalaryPretax: 52000, hourlyRate: 25,
    regularHoursPerWeek: 40, otThresholdHoursPerWeek: null,
  });

  it('an untouched Next on a legacy Hourly row with a stale salary writes nothing, so the salary holds', async () => {
    const ctx = ctxWith({ persons: [LEGACY_HOURLY] });
    expect(await savePay('you', prefillPay(ctx, 'you'), ctx)).toEqual({ ok: true });
    expect(personsUpdate).not.toHaveBeenCalled();
  });

  it('an untouched Next writes nothing for each pay type, for you and for the partner', async () => {
    const rows = [
      makePerson({ id: 7, employmentType: 'SALARY_NO_OT', annualSalaryPretax: 95000, regularHoursPerWeek: 37.5 }),
      makePerson({ id: 7, employmentType: 'HOURLY', annualSalaryPretax: 0, hourlyRate: 30, regularHoursPerWeek: 36 }),
      makePerson({
        id: 7, employmentType: 'SALARY_WITH_OT', annualSalaryPretax: 70000, hourlyRate: 40, otThresholdHoursPerWeek: 40,
      }),
    ];
    for (const p of rows) {
      const ctx = ctxWith({ persons: [p] });
      expect(await savePay('you', prefillPay(ctx, 'you'), ctx)).toEqual({ ok: true });
    }
    const couple = ctxWith({
      persons: [makePerson({ id: 1 }), makePerson({ id: 2, employmentType: 'SALARY_NO_OT', annualSalaryPretax: 88000 })],
    });
    expect(await savePay('partner', prefillPay(couple, 'partner'), couple)).toEqual({ ok: true });
    expect(personsUpdate).not.toHaveBeenCalled();
  });

  it('every edited field still saves through the one employment contract, which then zeroes the stale salary', async () => {
    const ctx = ctxWith({ persons: [LEGACY_HOURLY] });
    await savePay('you', { ...prefillPay(ctx, 'you'), hourlyRate: 26 }, ctx);
    expect(personsUpdate).toHaveBeenCalledWith(7, {
      employmentType: 'HOURLY', annualSalaryPretax: 0, hourlyRate: 26, regularHoursPerWeek: 40, otThresholdHoursPerWeek: null,
    });
    const ot = ctxWith({
      persons: [makePerson({
        id: 8, employmentType: 'SALARY_WITH_OT', annualSalaryPretax: 70000, hourlyRate: 40,
        regularHoursPerWeek: 40, otThresholdHoursPerWeek: 40,
      })],
    });
    const edits = [
      { employmentType: 'SALARY_NO_OT' as const }, { annualSalaryPretax: '72000' }, { hourlyRate: 41 },
      { regularHoursPerWeek: '45' }, { otThresholdHoursPerWeek: 42 },
    ];
    for (const edit of edits) {
      personsUpdate.mockClear();
      await savePay('you', { ...prefillPay(ot, 'you'), ...edit }, ot);
      expect(personsUpdate, JSON.stringify(edit)).toHaveBeenCalledTimes(1);
    }
  });

  it('an untouched Next on a bound row the contract cannot accept is still refused (control)', async () => {
    const ctx = ctxWith({ persons: [makePerson({ id: 7, employmentType: 'HOURLY', annualSalaryPretax: 52000, hourlyRate: null })] });
    expect(await savePay('you', prefillPay(ctx, 'you'), ctx)).toEqual({ ok: false });
    expect(personsUpdate).not.toHaveBeenCalled();
  });
});

describe('2c answer record — an HSA No and a typed 0 re-read as given (v1.8.0 O3 code review, CR-O-5)', () => {
  // A saved 0 reads the same as a field never answered, and an HSA "No" over
  // no saved contribution writes nothing at all, so 2c records those facts in
  // the progress record (never a figure) and its prefill re-reads them while
  // they are about this person and the row still reads 0 there.
  const NONE: BenefitsValues = { pct401k: null, hsaContributes: null, hsaEligible: false, hsaMonthly: null, premiumMonthly: null };
  const recordOf = async (role: 'you' | 'partner', v: BenefitsValues, ctx: FlowCtx) => {
    const r = await saveBenefits(role, v, ctx);
    return r.ok && r.progressUpdate ? r.progressUpdate(ctx.progress).drafts.benefits : undefined;
  };

  it('saveBenefits records the HSA answer over a 0 contribution and the fields typed as 0', async () => {
    const fresh = ctxWith({ persons: [makePerson({ id: 7 })] });
    expect(await recordOf('you', { ...NONE, pct401k: 0, hsaContributes: false, premiumMonthly: 0 }, fresh))
      .toEqual({ you: { personId: 7, hsa: 'no', zeros: ['pct401k', 'premiumMonthly'] } });
    expect(await recordOf('you', { ...NONE, hsaContributes: true, hsaEligible: true }, fresh))
      .toEqual({ you: { personId: 7, hsa: 'yes', zeros: [] } });
    expect(await recordOf('you', { ...NONE, hsaContributes: true, hsaEligible: true, hsaMonthly: 0 }, fresh))
      .toEqual({ you: { personId: 7, hsa: 'yes', zeros: ['hsaMonthly'] } });
    // A Yes the row holds itself (a saved contribution) needs no record of it.
    expect(await recordOf('you', { pct401k: 6, hsaContributes: true, hsaEligible: true, hsaMonthly: 250, premiumMonthly: 180 }, fresh))
      .toEqual({ you: { personId: 7, hsa: null, zeros: [] } });
    const saved = ctxWith({ persons: [makePerson({ id: 7, hsaMonthlyContribution: 150 })] });
    expect(await recordOf('you', { ...NONE, hsaContributes: true }, saved))
      .toEqual({ you: { personId: 7, hsa: null, zeros: [] } });
    // An explicit No over a saved contribution writes the honest zero, and is recorded.
    expect(await recordOf('you', { ...NONE, hsaContributes: false }, saved))
      .toEqual({ you: { personId: 7, hsa: 'no', zeros: [] } });
    // Per role: the partner's record sits beside yours.
    const couple = ctxWith({
      persons: [makePerson({ id: 1 }), makePerson({ id: 2 })],
      progress: progressWith({ drafts: { benefits: { you: { personId: 1, hsa: 'no', zeros: [] } } } }),
    });
    expect(await recordOf('partner', { ...NONE, hsaContributes: false }, couple)).toEqual({
      you: { personId: 1, hsa: 'no', zeros: [] }, partner: { personId: 2, hsa: 'no', zeros: [] },
    });
  });

  it('prefillBenefits re-reads a recorded answer as given, and its untouched re-save writes the same and keeps the record', async () => {
    const answers: Array<[string, BenefitsValues]> = [
      ['a 0 % 401(k), HSA No and a $0 premium', { ...NONE, pct401k: 0, hsaContributes: false, premiumMonthly: 0 }],
      ['HSA Yes on a qualified plan, no amount', { ...NONE, hsaContributes: true, hsaEligible: true }],
      ['HSA Yes with a $0 contribution', { ...NONE, hsaContributes: true, hsaMonthly: 0 }],
    ];
    for (const [label, v] of answers) {
      const before = ctxWith({ persons: [makePerson({ id: 7 })] });
      const first = await saveBenefits('you', v, before);
      const progress = first.ok && first.progressUpdate ? first.progressUpdate(before.progress) : before.progress;
      const written = personsUpdate.mock.calls.at(-1)?.[1] as object | undefined;
      const reentry = ctxWith({ persons: [makePerson({ id: 7, ...written })], progress });
      expect(prefillBenefits(reentry, 'you'), label).toEqual(v);
      personsUpdate.mockClear();
      const again = await saveBenefits('you', prefillBenefits(reentry, 'you'), reentry);
      expect(again.ok && again.progressUpdate ? again.progressUpdate(progress) : progress, label).toEqual(progress);
      if (written) expect(personsUpdate, label).toHaveBeenCalledWith(7, written);
      else expect(personsUpdate, label).not.toHaveBeenCalled();
    }
  });

  it('a record the row no longer matches is ignored — a figure saved since, or another person, wins (control)', () => {
    const record = { personId: 7, hsa: 'no' as const, zeros: ['pct401k' as const, 'premiumMonthly' as const] };
    const changed = ctxWith({
      persons: [makePerson({ id: 7, pretax401kPct: 0.05, hsaMonthlyContribution: 100, healthInsuranceMonthlyPremium: 200 })],
      progress: progressWith({ drafts: { benefits: { you: record } } }),
    });
    expect(prefillBenefits(changed, 'you'))
      .toEqual({ pct401k: 5, hsaContributes: true, hsaEligible: false, hsaMonthly: 100, premiumMonthly: 200 });
    const other = ctxWith({
      persons: [makePerson({ id: 9 })],
      progress: progressWith({ drafts: { benefits: { you: record } } }),
    });
    expect(prefillBenefits(other, 'you')).toEqual(NONE);
    // Another role's record is not this role's answer.
    const couple = ctxWith({
      persons: [makePerson({ id: 1 }), makePerson({ id: 2 })],
      progress: progressWith({ drafts: { benefits: { you: { ...record, personId: 2 } } } }),
    });
    expect(prefillBenefits(couple, 'partner')).toEqual(NONE);
  });
});
