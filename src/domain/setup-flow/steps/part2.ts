import { usePersonsStore } from '@/stores/persons-store';
import { DEFAULT_PERSON, type PersonScaffoldValues } from '@/lib/entity-scaffolds';
import {
  employmentDraftFromPerson, employmentPatchFromDraft, validateEmploymentDraft,
  type EmploymentDraft,
} from '@/lib/employment-fields';
import { percentToFraction } from '@/lib/percent-fields';
import type { Role } from '@/lib/setup-progress';
import type { Person } from '@/types/schema';
import { resolveBindings } from '../engine';
import type { FlowCtx, StepSaveResult } from '../types';

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

export async function savePay(
  role: Role, draft: EmploymentDraft, ctx: FlowCtx,
): Promise<StepSaveResult> {
  const v = validateEmploymentDraft(draft);
  if (!v.ok) return { ok: false };
  const bound = personForRole(ctx, role);
  if (bound?.id != null) {
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
  if (Object.keys(patch).length === 0) return { ok: true }; // nothing entered → nothing written
  await usePersonsStore.getState().update(bound.id, patch);
  return { ok: true };
}
