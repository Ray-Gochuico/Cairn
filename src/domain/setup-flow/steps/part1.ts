import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import type { FilingStatus } from '@/types/enums';
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

/** Spec conflict contract: ≥2 persons with SINGLE/HOH, or <2 with MFJ/MFS. */
export function maritalConflict(ctx: FlowCtx): boolean {
  const fs = ctx.household?.filingStatus;
  if (fs == null) return false;
  const married = fs === 'MFJ' || fs === 'MFS';
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
  if (fs === 'MFJ') return { ...EMPTY_MARITAL_VALUES, married: 'yes', filing: 'jointly' };
  if (fs === 'MFS') return { ...EMPTY_MARITAL_VALUES, married: 'yes', filing: 'separately' };
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
  if (values.married === 'yes') {
    if (partner?.id != null) {
      // Reuse the existing person 2 (CW-19): bind, never draft or create.
      const partnerId = partner.id;
      return {
        ok: true,
        progressUpdate: (p) => ({ ...p, bindings: { ...p.bindings, partner: partnerId } }),
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
          },
        }),
      };
    }
    return { ok: true };
  }
  // married: no — filingStatus only; person 2 is NEVER deleted (CW-18 renders
  // in the step UI); only the un-created partner DRAFT is cleared.
  return {
    ok: true,
    progressUpdate: (p) => ({ ...p, drafts: { ...p.drafts, partner: undefined } }),
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
