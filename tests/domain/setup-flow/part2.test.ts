import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nameForRole, savePay, saveRetirement, saveBenefits } from '@/domain/setup-flow/steps/part2';
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
