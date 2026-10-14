import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import type { FilingStatus } from '@/types/enums';
import type { MaritalAnswer } from '@/lib/setup-progress';
import { resolveBindings } from '../engine';
import type { FlowCtx, StepSaveResult } from '../types';

// ── 1a — about you ──────────────────────────────────────────────────────────
export interface AboutYouValues { name: string; dateOfBirth: string }

export function prefillAboutYou(ctx: FlowCtx): AboutYouValues {
  const { you } = resolveBindings(ctx);
  if (you) return { name: you.name, dateOfBirth: you.dateOfBirth };
  return ctx.progress.drafts.you ?? { name: '', dateOfBirth: '' };
}

export async function saveAboutYou(values: AboutYouValues, ctx: FlowCtx): Promise<StepSaveResult> {
  if (values.name.trim() === '' || values.dateOfBirth === '') return { ok: false };
  const { you } = resolveBindings(ctx);
  if (you?.id != null) {
    await usePersonsStore.getState().update(you.id, {
      name: values.name, dateOfBirth: values.dateOfBirth,
    });
    return { ok: true };
  }
  // Deferred creation (owner constraint 8): draft only, no row.
  return {
    ok: true,
    progressUpdate: (p) => ({ ...p, drafts: { ...p.drafts, you: { ...values } } }),
  };
}

// ── 1b — marital / filing ───────────────────────────────────────────────────
export interface MaritalFilingValues {
  married: 'yes' | 'no' | null;
  filing: 'jointly' | 'separately' | 'complicated' | null;
  complicatedStatus: FilingStatus | null;
  noChoice: 'single' | 'hoh' | null;
  partnerName: string;
  partnerDob: string;
}
export const EMPTY_MARITAL_VALUES: MaritalFilingValues = {
  married: null, filing: null, complicatedStatus: null, noChoice: null,
  partnerName: '', partnerDob: '',
};

/** Spec conflict contract: ≥2 persons with SINGLE/HOH, or <2 with MFJ/MFS.
 *  Review M1: under deferred creation, EVERY married-branch user occupies the
 *  persons<2 + married state between 1b's save and the one-shot creates — a
 *  pending pre-creation draft or binding marks that state as the flow's OWN
 *  transient, never a genuine mismatch. Drafts clear post-create, so genuine
 *  pre-existing-entity conflicts still engage exactly per D-WF17. */
export function maritalConflict(ctx: FlowCtx): boolean {
  const fs = ctx.household?.filingStatus;
  if (fs == null) return false;
  const married = fs === 'MFJ' || fs === 'MFS';
  const pendingFlowState =
    ctx.progress.drafts.partner != null ||
    ctx.progress.drafts.you != null ||
    ctx.progress.bindings.partner != null;
  if (married && ctx.persons.length < 2 && pendingFlowState) return false;
  return (ctx.persons.length >= 2 && !married) || (ctx.persons.length < 2 && married);
}

export function filingStatusFromValues(v: MaritalFilingValues): FilingStatus | null {
  if (v.married === 'yes') {
    if (v.filing === 'jointly') return 'MFJ';
    if (v.filing === 'separately') return 'MFS';
    if (v.filing === 'complicated') return v.complicatedStatus;
    return null;
  }
  if (v.married === 'no') {
    if (v.noChoice === 'single') return 'SINGLE';
    if (v.noChoice === 'hoh') return 'HOH';
    return null;
  }
  return null;
}

/** Prefill for an ALREADY-ASKED step (never-asked steps render unanswered —
 *  Persistence rule 6; the household row is pre-seeded SINGLE/CA/$0). */
export function prefillMaritalFiling(ctx: FlowCtx): MaritalFilingValues {
  const fs = ctx.household?.filingStatus;
  // Review M1: a pending partner draft is edited HERE (its only editor) —
  // carry it into the CW-16 fields on re-entry.
  const draft = ctx.progress.drafts.partner;
  const partnerFields = draft
    ? { partnerName: draft.name, partnerDob: draft.dateOfBirth }
    : {};
  // v1.8.0 O3 (CL-O3-1): 1b's own answer, recorded at its save, re-reads a
  // complicated pick verbatim, partner or not, while the saved status still
  // matches it. A status changed elsewhere (Inputs → Household) wins, and
  // progress saved before this build carries no answer: both fall through to
  // the reading below. Jointly, Separately and No need no record — the saved
  // status alone re-reads them.
  const answer = ctx.progress.drafts.marital;
  if (answer?.filing === 'complicated' && fs != null && answer.complicatedStatus === fs) {
    return { ...EMPTY_MARITAL_VALUES, ...answer, ...partnerFields };
  }
  if (fs === 'MFJ') {
    return { ...EMPTY_MARITAL_VALUES, married: 'yes', filing: 'jointly', ...partnerFields };
  }
  if (fs === 'MFS') {
    return { ...EMPTY_MARITAL_VALUES, married: 'yes', filing: 'separately', ...partnerFields };
  }
  // v1.8.0 O3 (RC4, CR-O-5): a pending partner draft beside a Single or Head
  // of Household status comes from Yes → "It's more complicated" → that
  // status (a "No" save clears the draft), or from a status changed in
  // Household while the draft pends. Either way re-entry re-reads Yes → "It's
  // more complicated" with the draft, so an untouched Next keeps both. It
  // used to re-read as "No", and that Next deleted the draft.
  if (draft && (fs === 'SINGLE' || fs === 'HOH')) {
    return {
      ...EMPTY_MARITAL_VALUES, married: 'yes', filing: 'complicated', complicatedStatus: fs,
      ...partnerFields,
    };
  }
  if (fs === 'HOH') return { ...EMPTY_MARITAL_VALUES, married: 'no', noChoice: 'hoh' };
  return { ...EMPTY_MARITAL_VALUES, married: 'no', noChoice: 'single' };
}

export async function saveMaritalFiling(
  values: MaritalFilingValues, ctx: FlowCtx,
): Promise<StepSaveResult> {
  const fs = filingStatusFromValues(values);
  if (fs == null) return { ok: false };
  // ONE household write — filing status only (D-WF15).
  await useHouseholdStore.getState().update({ filingStatus: fs });
  const { partner } = resolveBindings(ctx);
  // v1.8.0 O3 (CL-O3-1): every save records 1b's own answer shape beside the
  // status (progress only, device-local), so re-entry re-reads a complicated
  // pick as picked (prefillMaritalFiling).
  const answer: MaritalAnswer = values.married === 'yes'
    ? {
        married: 'yes', filing: values.filing,
        complicatedStatus: values.filing === 'complicated' ? fs : null,
      }
    : { married: 'no', filing: null, complicatedStatus: null };
  if (values.married === 'yes') {
    if (partner?.id != null) {
      // Reuse the existing person 2 (CW-19): bind, never draft or create.
      const partnerId = partner.id;
      return {
        ok: true,
        progressUpdate: (p) => ({
          ...p,
          bindings: { ...p.bindings, partner: partnerId },
          drafts: { ...p.drafts, marital: answer },
        }),
      };
    }
    if (values.partnerName.trim() !== '' || values.partnerDob !== '') {
      return {
        ok: true,
        progressUpdate: (p) => ({
          ...p,
          drafts: {
            ...p.drafts,
            partner: { name: values.partnerName, dateOfBirth: values.partnerDob },
            marital: answer,
          },
        }),
      };
    }
    return { ok: true, progressUpdate: (p) => ({ ...p, drafts: { ...p.drafts, marital: answer } }) };
  }
  // married: no — filingStatus only; person 2 is NEVER deleted (CW-18 renders
  // in the step UI); only the un-created partner DRAFT is cleared.
  return {
    ok: true,
    progressUpdate: (p) => ({ ...p, drafts: { ...p.drafts, partner: undefined, marital: answer } }),
  };
}

/** Conflict-mode save (D-WF17): the 4-way escape hatch writes the status directly. */
export async function saveConflictFiling(status: FilingStatus | null): Promise<StepSaveResult> {
  if (status == null) return { ok: false };
  await useHouseholdStore.getState().update({ filingStatus: status });
  return { ok: true };
}

// ── 1c — state / city ───────────────────────────────────────────────────────
export interface StateCityValues { state: string | null; city: string | null }

export function prefillStateCity(ctx: FlowCtx): StateCityValues {
  return { state: ctx.household?.state ?? null, city: ctx.household?.city ?? null };
}

export async function saveStateCity(values: StateCityValues, _ctx: FlowCtx): Promise<StepSaveResult> {
  if (values.state == null || values.state.length !== 2) return { ok: false };
  // Mismatched city auto-clears, exactly as HouseholdForm does.
  const city =
    values.city != null && values.city.startsWith(`${values.state}_`) ? values.city : null;
  await useHouseholdStore.getState().update({ state: values.state, city });
  return { ok: true };
}

// ── 1e — expenses ───────────────────────────────────────────────────────────
export async function saveExpenses(
  values: { monthly: number | null }, _ctx: FlowCtx,
): Promise<StepSaveResult> {
  if (values.monthly == null) return { ok: true }; // nothing entered → writes NOTHING (D-WF18)
  await useHouseholdStore.getState().update({ monthlyExpenseBaseline: values.monthly });
  return { ok: true };
}
