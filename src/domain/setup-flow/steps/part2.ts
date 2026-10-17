import { usePersonsStore } from '@/stores/persons-store';
import { DEFAULT_PERSON, type PersonScaffoldValues } from '@/lib/entity-scaffolds';
import {
  employmentDraftFromPerson, employmentPatchFromDraft, validateEmploymentDraft,
  type EmploymentDraft,
} from '@/lib/employment-fields';
import { fractionToPercent, percentToFraction } from '@/lib/percent-fields';
import type { BenefitsAnswer, Role } from '@/lib/setup-progress';
import type { Person } from '@/types/schema';
import { resolveBindings } from '../engine';
import type { FlowCtx, ProgressUpdate, StepSaveResult } from '../types';

export function personForRole(ctx: FlowCtx, role: Role): Person | undefined {
  const { you, partner } = resolveBindings(ctx);
  return role === 'you' ? you : partner;
}

/** {name} slot for the CW-24/26/27/28 strings. */
export function nameForRole(ctx: FlowCtx, role: Role): string {
  const bound = personForRole(ctx, role);
  if (bound?.name) return bound.name;
  const draft = role === 'you' ? ctx.progress.drafts.you : ctx.progress.drafts.partner;
  if (draft?.name) return draft.name;
  return role === 'you' ? 'you' : 'your partner';
}

export function prefillPay(ctx: FlowCtx, role: Role): EmploymentDraft {
  const bound = personForRole(ctx, role);
  if (bound) return employmentDraftFromPerson(bound);
  const parked = ctx.progress.drafts.pay?.[role];
  if (parked) {
    return {
      employmentType: parked.employmentType,
      annualSalaryPretax: parked.annualSalaryPretax == null ? '' : String(parked.annualSalaryPretax),
      hourlyRate: parked.hourlyRate,
      regularHoursPerWeek:
        parked.regularHoursPerWeek == null ? '' : String(parked.regularHoursPerWeek),
      otThresholdHoursPerWeek: parked.otThresholdHoursPerWeek,
    };
  }
  return {
    employmentType: 'SALARY_NO_OT', annualSalaryPretax: '',
    hourlyRate: null, regularHoursPerWeek: '40', otThresholdHoursPerWeek: null,
  };
}

/** v1.8.0 O3 (CL-O3-2): the five pay fields of a draft, compared as entered. */
function sameEmploymentDraft(a: EmploymentDraft, b: EmploymentDraft): boolean {
  return (
    a.employmentType === b.employmentType &&
    a.annualSalaryPretax === b.annualSalaryPretax &&
    a.hourlyRate === b.hourlyRate &&
    a.regularHoursPerWeek === b.regularHoursPerWeek &&
    a.otThresholdHoursPerWeek === b.otThresholdHoursPerWeek
  );
}

export async function savePay(
  role: Role, draft: EmploymentDraft, ctx: FlowCtx,
): Promise<StepSaveResult> {
  const v = validateEmploymentDraft(draft);
  if (!v.ok) return { ok: false };
  const bound = personForRole(ctx, role);
  if (bound?.id != null) {
    // v1.8.0 O3 (CL-O3-2, D-O3-15): an untouched Next re-submits the bound
    // row's own prefill, so it writes nothing — re-entry never rewrites a
    // saved row (a legacy Hourly row keeps its stored salary). Any edit still
    // saves through the one employment contract below.
    if (sameEmploymentDraft(draft, prefillPay(ctx, role))) return { ok: true };
    await usePersonsStore.getState().update(
      bound.id,
      employmentPatchFromDraft(draft, bound.regularHoursPerWeek),
    );
    return { ok: true };
  }
  // Deferred creation: park the normalized patch as a pay draft.
  const patch = employmentPatchFromDraft(draft, null);
  return {
    ok: true,
    progressUpdate: (p) => ({
      ...p,
      drafts: { ...p.drafts, pay: { ...p.drafts.pay, [role]: { ...patch } } },
    }),
  };
}

export async function saveRetirement(role: Role, age: number, ctx: FlowCtx): Promise<StepSaveResult> {
  if (!Number.isInteger(age) || age < 30 || age > 90) return { ok: false };
  const bound = personForRole(ctx, role);
  if (bound?.id != null) {
    await usePersonsStore.getState().update(bound.id, { targetRetirementAge: age });
    return { ok: true };
  }
  // THE one-shot create (owner constraint 8): real answers over the scaffold.
  const personDraft = role === 'you' ? ctx.progress.drafts.you : ctx.progress.drafts.partner;
  if (personDraft == null || personDraft.name.trim() === '' || personDraft.dateOfBirth === '') {
    return { ok: false }; // registry order guarantees 1a/1b ran; a missing draft is a real error
  }
  const pay = ctx.progress.drafts.pay?.[role];
  const values: PersonScaffoldValues = {
    ...DEFAULT_PERSON,
    name: personDraft.name,
    dateOfBirth: personDraft.dateOfBirth,
    ...(pay
      ? {
          employmentType: pay.employmentType,
          annualSalaryPretax: pay.annualSalaryPretax ?? 0,
          hourlyRate: pay.hourlyRate,
          regularHoursPerWeek: pay.regularHoursPerWeek ?? 40,
          otThresholdHoursPerWeek: pay.otThresholdHoursPerWeek,
        }
      : {}),
    targetRetirementAge: age,
  };
  const id = await usePersonsStore.getState().create(values);
  return {
    ok: true,
    progressUpdate: (p) => ({
      ...p,
      bindings: { ...p.bindings, [role]: id },
      drafts: { ...p.drafts, [role]: undefined, pay: { ...p.drafts.pay, [role]: undefined } },
    }),
  };
}

export interface BenefitsValues {
  pct401k: number | null;         // whole percent (0–100), converted at save
  hsaContributes: boolean | null; // the CW-28 yes/no; null = unanswered
  hsaEligible: boolean;
  hsaMonthly: number | null;
  premiumMonthly: number | null;
}

/** 2c's seed (CW-28). Review M5 (D-W4): a bound person's saved cells
 *  prefill regardless of the asked flag — Settings → Revisit setup opens with
 *  progress cleared. Review m4: the HSA yes/no seeds from the CONTRIBUTION —
 *  after an explicit-No save wrote the honest zero, eligibility alone must not
 *  flip the control back to Yes. v1.8.0 O3 (code review, CR-O-5): 2c's own
 *  record adds what the row cannot say (an HSA "Yes" or "No" over a 0
 *  contribution, a field typed as 0) while it is about this person and the
 *  row still reads 0 there; a figure saved since wins. */
export function prefillBenefits(ctx: FlowCtx, role: Role): BenefitsValues {
  const bound = personForRole(ctx, role);
  if (!bound) {
    return { pct401k: null, hsaContributes: null, hsaEligible: false, hsaMonthly: null, premiumMonthly: null };
  }
  const recorded = ctx.progress.drafts.benefits?.[role];
  const answer = recorded?.personId === bound.id ? recorded : undefined;
  const zero = (field: BenefitsAnswer['zeros'][number]) => (answer?.zeros.includes(field) ? 0 : null);
  return {
    pct401k: bound.pretax401kPct > 0 ? fractionToPercent(bound.pretax401kPct) : zero('pct401k'),
    hsaContributes:
      bound.hsaMonthlyContribution > 0 ? true : answer?.hsa == null ? null : answer.hsa === 'yes',
    hsaEligible: bound.hsaEligible,
    hsaMonthly: bound.hsaMonthlyContribution || zero('hsaMonthly'),
    premiumMonthly: bound.healthInsuranceMonthlyPremium || zero('premiumMonthly'),
  };
}

export async function saveBenefits(
  role: Role, v: BenefitsValues, ctx: FlowCtx,
): Promise<StepSaveResult> {
  const bound = personForRole(ctx, role);
  if (bound?.id == null) return { ok: false }; // benefits always follows the create
  const patch: Partial<Person> = {};
  if (v.pct401k != null) patch.pretax401kPct = percentToFraction(v.pct401k);
  if (v.hsaContributes === true) {
    patch.hsaEligible = v.hsaEligible;
    if (v.hsaMonthly != null) patch.hsaMonthlyContribution = v.hsaMonthly;
  } else if (v.hsaContributes === false && bound.hsaMonthlyContribution > 0) {
    // Review m4: an explicit "No" IS an answer, not a skip — a previously
    // saved contribution gets the honest zero (eligibility stays a fact of
    // its own and is not touched).
    patch.hsaMonthlyContribution = 0;
  }
  if (v.premiumMonthly != null) patch.healthInsuranceMonthlyPremium = v.premiumMonthly;
  // v1.8.0 O3 (code review, CR-O-5): record what the row cannot say, so
  // re-entry re-reads this answer as given (prefillBenefits). Progress only.
  const contribution = patch.hsaMonthlyContribution ?? bound.hsaMonthlyContribution;
  const zeros: BenefitsAnswer['zeros'] = [];
  if (v.pct401k === 0) zeros.push('pct401k');
  if (v.hsaContributes === true && v.hsaMonthly === 0) zeros.push('hsaMonthly');
  if (v.premiumMonthly === 0) zeros.push('premiumMonthly');
  const answer: BenefitsAnswer = {
    personId: bound.id,
    hsa: v.hsaContributes == null || contribution > 0 ? null : v.hsaContributes ? 'yes' : 'no',
    zeros,
  };
  const progressUpdate: ProgressUpdate = (p) => ({
    ...p, drafts: { ...p.drafts, benefits: { ...p.drafts.benefits, [role]: answer } },
  });
  if (Object.keys(patch).length === 0) return { ok: true, progressUpdate }; // nothing entered → nothing written
  await usePersonsStore.getState().update(bound.id, patch);
  return { ok: true, progressUpdate };
}
