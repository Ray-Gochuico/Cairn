import {
  STEP_ORDER, stepKey, stepMeta, stepVisible,
  type FlowPart, type Role, type StepStatus, type VisibilityInput,
} from '@/lib/setup-progress';
import type { Person } from '@/types/schema';
import type { FlowCtx, StepInstance } from './types';

export type GateStepId =
  | 'dependents_gate' | 'accounts_gate' | 'home_gate' | 'rent_gate'
  | 'vehicles_gate' | 'equity_gate' | 'loans_gate' | 'import_gate' | 'goals_gate';

/** What each gate counts (drives gate honesty + completion). */
export const GATE_ENTITY_COUNT: Record<GateStepId, (ctx: FlowCtx) => number> = {
  dependents_gate: (c) => c.dependents.length,
  accounts_gate: (c) => c.accounts.length,
  home_gate: (c) => c.properties.length,
  rent_gate: (c) => c.housingPayments.length,
  vehicles_gate: (c) => c.vehicles.length + c.vehicleLeases.length,
  equity_gate: (c) => c.equityGrants.length,
  loans_gate: (c) => c.loans.length,
  import_gate: (c) => c.transactions.length,
  goals_gate: (c) => c.goals.length,
};

/** D-WF6: explicit bindings win when the id still exists; else persons[0]
 *  (you) and the first OTHER person (partner). Pure — no writes. */
export function resolveBindings(ctx: FlowCtx): { you?: Person; partner?: Person } {
  const byId = new Map(ctx.persons.filter((p) => p.id != null).map((p) => [p.id!, p]));
  const bound = ctx.progress.bindings;
  const you = (bound.you != null ? byId.get(bound.you) : undefined) ?? ctx.persons[0];
  const partner =
    (bound.partner != null ? byId.get(bound.partner) : undefined) ??
    ctx.persons.find((p) => p !== you);
  return { you, partner };
}

export function visibilityInputOf(ctx: FlowCtx): VisibilityInput {
  const { partner } = resolveBindings(ctx);
  return {
    hasPartner: partner != null || ctx.progress.drafts.partner != null,
    homeGateStatus: ctx.progress.statuses['home_gate'] ?? 'pending',
    propertiesCount: ctx.properties.length,
    housingPaymentsCount: ctx.housingPayments.length,
  };
}

/** Ordered visible instances. Per-person parts expand as WHOLE role blocks
 *  (you's 2a→2c, then partner's — spec: "iterates roles you → partner").
 *  Part 2 is homogeneous per-person; mixed parts do not exist in this spine. */
export function visibleInstances(ctx: FlowCtx): StepInstance[] {
  const input = visibilityInputOf(ctx);
  const out: StepInstance[] = [];
  for (const part of [1, 2, 3, 4, 5] as FlowPart[]) {
    const metas = STEP_ORDER.filter((m) => m.part === part);
    if (metas.some((m) => m.perPerson)) {
      const roles: Role[] = input.hasPartner ? ['you', 'partner'] : ['you'];
      for (const role of roles) {
        for (const meta of metas) {
          if (!stepVisible(meta, role, input)) continue;
          out.push({ id: meta.id, role, key: stepKey(meta.id, role), part });
        }
      }
    } else {
      for (const meta of metas) {
        if (!stepVisible(meta, undefined, input)) continue;
        out.push({ id: meta.id, key: stepKey(meta.id), part });
      }
    }
  }
  return out;
}

/** Gate honesty (spec, decided): a skipped gate whose stores now have data is
 *  in_progress; an answered-yes gate with zero entities is in_progress. The
 *  stored status is otherwise authoritative; non-gates pass through. */
export function effectiveStatus(inst: StepInstance, ctx: FlowCtx): StepStatus {
  const stored = ctx.progress.statuses[inst.key] ?? 'pending';
  if (!stepMeta(inst.id).gate) return stored;
  const count = GATE_ENTITY_COUNT[inst.id as GateStepId](ctx);
  if (stored === 'skipped' && count > 0) return 'in_progress';
  if (stored === 'completed' && count === 0) return 'in_progress';
  return stored;
}

const countsCompleteForResume = (inst: StepInstance, ctx: FlowCtx): boolean => {
  const s = effectiveStatus(inst, ctx);
  return s === 'completed' || s === 'skipped';
};

/** Resume rule (spec): use the stored cursor when its instance exists, is
 *  visible, and does not count complete; else the first visible incomplete
 *  instance; null when everything counts complete (shell shows Finish). */
export function resumeTarget(ctx: FlowCtx): StepInstance | null {
  const instances = visibleInstances(ctx);
  const cur = ctx.progress.cursor;
  if (cur) {
    const found = instances.find((i) => i.id === cur.stepId && i.role === cur.role);
    if (found && !countsCompleteForResume(found, ctx)) return found;
  }
  return instances.find((i) => !countsCompleteForResume(i, ctx)) ?? null;
}

/** CW-2 arithmetic over visible instances at render time. */
export function partPosition(inst: StepInstance, ctx: FlowCtx): { index: number; count: number } {
  const inPart = visibleInstances(ctx).filter((i) => i.part === inst.part);
  return { index: inPart.findIndex((i) => i.key === inst.key) + 1, count: inPart.length };
}

/** Part chip status — the section-derivation rules over EFFECTIVE statuses. */
export function partStatus(part: FlowPart, ctx: FlowCtx): StepStatus {
  const st = visibleInstances(ctx)
    .filter((i) => i.part === part)
    .map((i) => effectiveStatus(i, ctx));
  if (st.length > 0 && st.every((s) => s === 'skipped')) return 'skipped';
  if (
    st.length > 0 &&
    st.every((s) => s === 'completed' || s === 'skipped') &&
    st.some((s) => s === 'completed')
  ) {
    return 'completed';
  }
  if (st.every((s) => s === 'pending')) return 'pending';
  return 'in_progress';
}

export function nextInstance(inst: StepInstance, ctx: FlowCtx): StepInstance | null {
  const list = visibleInstances(ctx);
  const i = list.findIndex((x) => x.key === inst.key);
  return i >= 0 && i + 1 < list.length ? list[i + 1] : null;
}

export function prevInstance(inst: StepInstance, ctx: FlowCtx): StepInstance | null {
  const list = visibleInstances(ctx);
  const i = list.findIndex((x) => x.key === inst.key);
  return i > 0 ? list[i - 1] : null;
}
