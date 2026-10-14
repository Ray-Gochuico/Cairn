import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  prefillAboutYou, saveAboutYou, maritalConflict, filingStatusFromValues,
  prefillMaritalFiling, saveMaritalFiling, saveStateCity, saveExpenses,
  EMPTY_MARITAL_VALUES,
} from '@/domain/setup-flow/steps/part1';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { defaultProgressV2 } from '@/lib/setup-progress';
import { visibleInstances } from '@/domain/setup-flow/engine';
import { makeHousehold, makePerson } from '../../factories';
import type { FlowCtx } from '@/domain/setup-flow/types';

const householdUpdate = vi.fn(async () => {});
const personsUpdate = vi.fn(async () => {});
const personsCreate = vi.fn(async () => 1);

function ctxWith(overrides: Partial<FlowCtx> = {}): FlowCtx {
  return {
    household: makeHousehold(), persons: [], dependents: [], accounts: [], properties: [],
    housingPayments: [], vehicles: [], vehicleLeases: [], equityGrants: [], loans: [],
    transactions: [], goals: [], progress: defaultProgressV2(), todayIso: '2026-08-09',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useHouseholdStore.setState({
    household: makeHousehold(), isLoading: false, error: null, update: householdUpdate,
  } as never);
  usePersonsStore.setState({
    persons: [], isLoading: false, error: null,
    update: personsUpdate, create: personsCreate, load: async () => {},
  } as never);
});

describe('part1 save mappers', () => {
  it('saveAboutYou with NO bound person drafts only — no person row is created (deferred creation)', async () => {
    const r = await saveAboutYou({ name: 'Alex Rivera', dateOfBirth: '1990-05-01' }, ctxWith());
    expect(personsCreate).not.toHaveBeenCalled();
    expect(personsUpdate).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    const updated = r.ok && r.progressUpdate ? r.progressUpdate(defaultProgressV2()) : null;
    expect(updated?.drafts.you).toEqual({ name: 'Alex Rivera', dateOfBirth: '1990-05-01' });
  });

  it('saveAboutYou with a bound person updates the row in place', async () => {
    const p = makePerson({ id: 7, name: 'Old' });
    await saveAboutYou({ name: 'New Name', dateOfBirth: '1990-05-01' },
      ctxWith({ persons: [p] }));
    expect(personsUpdate).toHaveBeenCalledWith(7, { name: 'New Name', dateOfBirth: '1990-05-01' });
    expect(personsCreate).not.toHaveBeenCalled();
  });

  it('prefillAboutYou: never-asked returns the draft/empties, asked returns cells', () => {
    expect(prefillAboutYou(ctxWith())).toEqual({ name: '', dateOfBirth: '' });
    const bound = ctxWith({ persons: [makePerson({ id: 1, name: 'Alex', dateOfBirth: '1990-05-01' })] });
    expect(prefillAboutYou(bound)).toEqual({ name: 'Alex', dateOfBirth: '1990-05-01' });
  });

  it('filingStatusFromValues covers every branch with literals', () => {
    const base = EMPTY_MARITAL_VALUES;
    expect(filingStatusFromValues({ ...base, married: 'yes', filing: 'jointly' })).toBe('MFJ');
    expect(filingStatusFromValues({ ...base, married: 'yes', filing: 'separately' })).toBe('MFS');
    expect(filingStatusFromValues({ ...base, married: 'yes', filing: 'complicated', complicatedStatus: 'HOH' })).toBe('HOH');
    expect(filingStatusFromValues({ ...base, married: 'no', noChoice: 'single' })).toBe('SINGLE');
    expect(filingStatusFromValues({ ...base, married: 'no', noChoice: 'hoh' })).toBe('HOH');
    expect(filingStatusFromValues({ ...base, married: 'yes', filing: null })).toBeNull();
    expect(filingStatusFromValues(base)).toBeNull();
  });

  it('conflict contract: ≥2 persons with SINGLE/HOH, or <2 with MFJ/MFS', () => {
    const two = [makePerson({ id: 1 }), makePerson({ id: 2 })];
    expect(maritalConflict(ctxWith({ household: makeHousehold({ filingStatus: 'SINGLE' }), persons: two }))).toBe(true);
    expect(maritalConflict(ctxWith({ household: makeHousehold({ filingStatus: 'MFJ' }), persons: [makePerson({ id: 1 })] }))).toBe(true);
    expect(maritalConflict(ctxWith({ household: makeHousehold({ filingStatus: 'MFJ' }), persons: two }))).toBe(false);
    expect(maritalConflict(ctxWith({ household: makeHousehold({ filingStatus: 'SINGLE' }), persons: [] }))).toBe(false);
  });

  it('M1: no conflict while the flow holds a pending pre-creation draft or binding', () => {
    // Deferred creation puts EVERY married-branch user in the persons<2 +
    // MFJ state between 1b's save and the partner's one-shot create — that
    // is the flow's own transient, never a genuine mismatch.
    expect(maritalConflict(ctxWith({
      household: makeHousehold({ filingStatus: 'MFJ' }),
      persons: [],
      progress: {
        ...defaultProgressV2(),
        drafts: { partner: { name: 'Sam', dateOfBirth: '1991-02-03' } },
      },
    }))).toBe(false);
    // The escape-hatch case: MFS picked with no partner drafted yet, but the
    // user's own 1a draft still pends.
    expect(maritalConflict(ctxWith({
      household: makeHousehold({ filingStatus: 'MFS' }),
      persons: [],
      progress: {
        ...defaultProgressV2(),
        drafts: { you: { name: 'Alex', dateOfBirth: '1990-05-01' } },
      },
    }))).toBe(false);
    expect(maritalConflict(ctxWith({
      household: makeHousehold({ filingStatus: 'MFJ' }),
      persons: [makePerson({ id: 1 })],
      progress: { ...defaultProgressV2(), bindings: { partner: 2 } },
    }))).toBe(false);
  });

  it('M1: prefillMaritalFiling carries the pending partner draft into the CW-16 fields', () => {
    const ctx = ctxWith({
      household: makeHousehold({ filingStatus: 'MFJ' }),
      progress: {
        ...defaultProgressV2(),
        drafts: { partner: { name: 'Sam Rivera', dateOfBirth: '1991-02-03' } },
      },
    });
    const prefill = prefillMaritalFiling(ctx);
    expect(prefill.married).toBe('yes');
    expect(prefill.partnerName).toBe('Sam Rivera');
    expect(prefill.partnerDob).toBe('1991-02-03');
  });

  it('married yes drafts the partner (no row!) and writes filingStatus only', async () => {
    const r = await saveMaritalFiling({
      ...EMPTY_MARITAL_VALUES, married: 'yes', filing: 'jointly',
      partnerName: 'Sam Rivera', partnerDob: '1991-02-03',
    }, ctxWith({ persons: [makePerson({ id: 1 })] }));
    expect(householdUpdate).toHaveBeenCalledWith({ filingStatus: 'MFJ' });
    expect(personsCreate).not.toHaveBeenCalled();
    const updated = r.ok && r.progressUpdate ? r.progressUpdate(defaultProgressV2()) : null;
    expect(updated?.drafts.partner).toEqual({ name: 'Sam Rivera', dateOfBirth: '1991-02-03' });
  });

  it('married yes with an existing person 2 REUSES it: binding patched, nothing drafted', async () => {
    const two = [makePerson({ id: 1 }), makePerson({ id: 2, name: 'Sam' })];
    const r = await saveMaritalFiling(
      { ...EMPTY_MARITAL_VALUES, married: 'yes', filing: 'separately' },
      ctxWith({ household: makeHousehold({ filingStatus: 'MFS' }), persons: two }),
    );
    const updated = r.ok && r.progressUpdate ? r.progressUpdate(defaultProgressV2()) : null;
    expect(updated?.bindings.partner).toBe(2);
    expect(updated?.drafts.partner).toBeUndefined();
  });

  it('married yes→no writes filingStatus ONLY — person 2 is NEVER deleted; partner draft cleared', async () => {
    const removeSpy = vi.fn(async () => {});
    usePersonsStore.setState({ remove: removeSpy } as never);
    const two = [makePerson({ id: 1 }), makePerson({ id: 2 })];
    const r = await saveMaritalFiling(
      { ...EMPTY_MARITAL_VALUES, married: 'no', noChoice: 'single' },
      ctxWith({ household: makeHousehold({ filingStatus: 'MFJ' }), persons: two }),
    );
    expect(householdUpdate).toHaveBeenCalledWith({ filingStatus: 'SINGLE' });
    expect(removeSpy).not.toHaveBeenCalled();
    const updated = r.ok && r.progressUpdate
      ? r.progressUpdate({ ...defaultProgressV2(), drafts: { partner: { name: 'X', dateOfBirth: '' } } })
      : null;
    expect(updated?.drafts.partner).toBeUndefined();
  });

  it('saveStateCity auto-clears a city whose prefix no longer matches (HouseholdForm parity)', async () => {
    await saveStateCity({ state: 'NY', city: 'NY_NYC' }, ctxWith());
    expect(householdUpdate).toHaveBeenLastCalledWith({ state: 'NY', city: 'NY_NYC' });
    await saveStateCity({ state: 'CA', city: 'NY_NYC' }, ctxWith());
    expect(householdUpdate).toHaveBeenLastCalledWith({ state: 'CA', city: null });
  });

  it('expenses: an entered value writes the baseline; empty/skip writes NOTHING', async () => {
    await saveExpenses({ monthly: 4000 }, ctxWith());
    expect(householdUpdate).toHaveBeenCalledWith({ monthlyExpenseBaseline: 4000 });
    householdUpdate.mockClear();
    const r = await saveExpenses({ monthly: null }, ctxWith());
    expect(r.ok).toBe(true);
    expect(householdUpdate).not.toHaveBeenCalled();
  });
});

describe('1b prefill round trip — a complicated Single / Head of Household answer (v1.8.0 O3, RC4)', () => {
  // Yes → "It's more complicated" → Single or Head of Household with a partner
  // drafted used to re-read as "No", and an untouched Next deleted the draft.
  const JORDAN = { name: 'Jordan Lee', dateOfBirth: '1991-08-21' };
  const withDraft = (filingStatus: 'HOH' | 'SINGLE') =>
    ctxWith({
      household: makeHousehold({ filingStatus }),
      progress: { ...defaultProgressV2(), drafts: { partner: { ...JORDAN } } },
    });

  for (const fs of ['HOH', 'SINGLE'] as const) {
    it(`re-reads Yes → "It's more complicated" → ${fs} with the pending partner draft`, () => {
      expect(prefillMaritalFiling(withDraft(fs))).toEqual({
        ...EMPTY_MARITAL_VALUES, married: 'yes', filing: 'complicated', complicatedStatus: fs,
        partnerName: 'Jordan Lee', partnerDob: '1991-08-21',
      });
    });

    it(`an untouched re-save of the ${fs} prefill keeps the status, the partner draft and the partner's Part 2 steps`, async () => {
      const ctx = withDraft(fs);
      const r = await saveMaritalFiling(prefillMaritalFiling(ctx), ctx);
      expect(householdUpdate).toHaveBeenCalledWith({ filingStatus: fs });
      const after = r.ok && r.progressUpdate ? r.progressUpdate(ctx.progress) : ctx.progress;
      expect(after.drafts.partner).toEqual(JORDAN);
      expect(
        visibleInstances({ ...ctx, progress: after }).filter((i) => i.role === 'partner').map((i) => i.key),
      ).toEqual(['pay:partner', 'retirement:partner', 'benefits:partner']);
    });
  }

  it('without a partner draft a Single or Head of Household status still re-reads as No (control)', () => {
    expect(prefillMaritalFiling(ctxWith({ household: makeHousehold({ filingStatus: 'HOH' }) })))
      .toEqual({ ...EMPTY_MARITAL_VALUES, married: 'no', noChoice: 'hoh' });
    expect(prefillMaritalFiling(ctxWith({ household: makeHousehold({ filingStatus: 'SINGLE' }) })))
      .toEqual({ ...EMPTY_MARITAL_VALUES, married: 'no', noChoice: 'single' });
  });
});

describe("1b answer shape — a complicated answer re-reads verbatim (v1.8.0 O3, CL-O3-1)", () => {
  // 1b records its own answer shape in progress.drafts at every save, so a
  // complicated answer re-reads as picked even with no partner entered (the
  // inference above has no trace of "married" then). The shape is used only
  // while the saved status still matches it.
  const JORDAN = { name: 'Jordan Lee', dateOfBirth: '1991-08-21' };
  const afterSave = async (values: typeof EMPTY_MARITAL_VALUES, ctx: FlowCtx) => {
    const r = await saveMaritalFiling(values, ctx);
    return r.ok && r.progressUpdate ? r.progressUpdate(ctx.progress) : ctx.progress;
  };

  it("saveMaritalFiling records 1b's answer shape on every save", async () => {
    const complicated = await afterSave(
      { ...EMPTY_MARITAL_VALUES, married: 'yes', filing: 'complicated', complicatedStatus: 'HOH' }, ctxWith(),
    );
    expect(complicated.drafts.marital).toEqual({ married: 'yes', filing: 'complicated', complicatedStatus: 'HOH' });
    const jointly = await afterSave(
      { ...EMPTY_MARITAL_VALUES, married: 'yes', filing: 'jointly', partnerName: JORDAN.name, partnerDob: JORDAN.dateOfBirth },
      ctxWith(),
    );
    expect(jointly.drafts).toMatchObject({
      marital: { married: 'yes', filing: 'jointly', complicatedStatus: null }, partner: JORDAN,
    });
    const bound = await afterSave(
      { ...EMPTY_MARITAL_VALUES, married: 'yes', filing: 'separately' },
      ctxWith({ household: makeHousehold({ filingStatus: 'MFS' }), persons: [makePerson({ id: 1 }), makePerson({ id: 2 })] }),
    );
    expect(bound.drafts.marital).toEqual({ married: 'yes', filing: 'separately', complicatedStatus: null });
    expect(bound.bindings.partner).toBe(2);
    // A "No" after a complicated pick keeps no leftover filing answer.
    const no = await afterSave(
      { ...EMPTY_MARITAL_VALUES, married: 'no', noChoice: 'single', filing: 'complicated', complicatedStatus: 'HOH' },
      ctxWith(),
    );
    expect(no.drafts.marital).toEqual({ married: 'no', filing: null, complicatedStatus: null });
  });

  for (const fs of ['HOH', 'SINGLE'] as const) {
    it(`a partner-less Yes → "It's more complicated" → ${fs} re-reads verbatim, and its untouched re-save keeps it`, async () => {
      const picked = { ...EMPTY_MARITAL_VALUES, married: 'yes' as const, filing: 'complicated' as const, complicatedStatus: fs };
      const progress = await afterSave(picked, ctxWith());
      const reentry = ctxWith({ household: makeHousehold({ filingStatus: fs }), progress });
      expect(prefillMaritalFiling(reentry)).toEqual(picked);
      householdUpdate.mockClear();
      expect(await afterSave(prefillMaritalFiling(reentry), reentry)).toEqual(progress);
      expect(householdUpdate).toHaveBeenCalledWith({ filingStatus: fs });
    });
  }

  it('a stored complicated Married Filing Jointly answer re-reads verbatim with its partner draft', () => {
    expect(prefillMaritalFiling(ctxWith({
      household: makeHousehold({ filingStatus: 'MFJ' }),
      progress: {
        ...defaultProgressV2(),
        drafts: { partner: JORDAN, marital: { married: 'yes', filing: 'complicated', complicatedStatus: 'MFJ' } },
      },
    }))).toEqual({
      ...EMPTY_MARITAL_VALUES, married: 'yes', filing: 'complicated', complicatedStatus: 'MFJ',
      partnerName: JORDAN.name, partnerDob: JORDAN.dateOfBirth,
    });
  });

  it('a stored answer the saved status no longer matches is ignored — an edit made elsewhere wins (control)', () => {
    const stored = { married: 'yes' as const, filing: 'complicated' as const, complicatedStatus: 'HOH' as const };
    const withStatus = (filingStatus: 'MFJ' | 'SINGLE') => ctxWith({
      household: makeHousehold({ filingStatus }),
      progress: { ...defaultProgressV2(), drafts: { marital: stored } },
    });
    expect(prefillMaritalFiling(withStatus('MFJ'))).toEqual({ ...EMPTY_MARITAL_VALUES, married: 'yes', filing: 'jointly' });
    expect(prefillMaritalFiling(withStatus('SINGLE'))).toEqual({ ...EMPTY_MARITAL_VALUES, married: 'no', noChoice: 'single' });
  });
});
