import { z } from 'zod';

/**
 * Shared setup progress (v2) — ONE progress state consumed by BOTH the worded
 * flow and the card wizard (design D-W1/D-W4). Steps are the source of truth;
 * Section statuses are DERIVED in both directions. Device-local asked-ness
 * only — never entity data (one-place-per-thing). Pre-creation drafts (1a/1b
 * name+DOB, 2a pay) ride along until the owning save creates the entity.
 */

export const SETUP_PROGRESS_V1_KEY = 'setupWizard.progress.v1';
export const SETUP_PROGRESS_V2_KEY = 'setupWizard.progress.v2';

export type FlowPart = 1 | 2 | 3 | 4 | 5;
export type WizardSection = 1 | 2 | 3 | 4;
export type Role = 'you' | 'partner';
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export type StepId =
  | 'about_you' | 'marital_filing' | 'state_city' | 'dependents_gate' | 'expenses'
  | 'pay' | 'retirement' | 'benefits'
  | 'accounts_gate' | 'home_gate' | 'rent_gate' | 'vehicles_gate' | 'equity_gate'
  | 'loans_gate'
  | 'import_gate' | 'goals_gate';

export interface StepMeta {
  id: StepId;
  part: FlowPart;
  perPerson: boolean;
  gate: boolean;
}

/** Ordered spine. Ids are stable-forever — they are persisted progress keys. */
export const STEP_ORDER: readonly StepMeta[] = [
  { id: 'about_you', part: 1, perPerson: false, gate: false },
  { id: 'marital_filing', part: 1, perPerson: false, gate: false },
  { id: 'state_city', part: 1, perPerson: false, gate: false },
  { id: 'dependents_gate', part: 1, perPerson: false, gate: true },
  { id: 'expenses', part: 1, perPerson: false, gate: false },
  { id: 'pay', part: 2, perPerson: true, gate: false },
  { id: 'retirement', part: 2, perPerson: true, gate: false },
  { id: 'benefits', part: 2, perPerson: true, gate: false },
  { id: 'accounts_gate', part: 3, perPerson: false, gate: true },
  { id: 'home_gate', part: 3, perPerson: false, gate: true },
  { id: 'rent_gate', part: 3, perPerson: false, gate: true },
  { id: 'vehicles_gate', part: 3, perPerson: false, gate: true },
  { id: 'equity_gate', part: 3, perPerson: false, gate: true },
  { id: 'loans_gate', part: 4, perPerson: false, gate: true },
  { id: 'import_gate', part: 5, perPerson: false, gate: true },
  { id: 'goals_gate', part: 5, perPerson: false, gate: true },
];

export const PART_LABELS: Record<FlowPart, string> = {
  1: 'About you',
  2: 'Work & pay',
  3: 'What you own',
  4: 'What you owe',
  5: 'History & goals',
};

/** Parts 1–2 ↔ Section 1, Part 3 ↔ Section 2, Part 4 ↔ Section 3, Part 5 ↔ Section 4. */
export const PART_TO_SECTION: Record<FlowPart, WizardSection> = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4 };
export const SECTION_TO_PARTS: Record<WizardSection, FlowPart[]> = {
  1: [1, 2], 2: [3], 3: [4], 4: [5],
};
export const FIRST_STEP_OF_SECTION: Record<WizardSection, StepId> = {
  1: 'about_you', 2: 'accounts_gate', 3: 'loans_gate', 4: 'import_gate',
};

const STEP_BY_ID = new Map<StepId, StepMeta>(STEP_ORDER.map((s) => [s.id, s]));
export const isStepId = (v: string): v is StepId => STEP_BY_ID.has(v as StepId);
export const stepMeta = (id: StepId): StepMeta => STEP_BY_ID.get(id)!;
export const partOfStep = (id: StepId): FlowPart => stepMeta(id).part;
export const stepKey = (id: StepId, role?: Role): string => (role ? `${id}:${role}` : id);

// ── Persisted shape ─────────────────────────────────────────────────────────
const StepStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'skipped']);
const RoleSchema = z.enum(['you', 'partner']);
const PersonDraftSchema = z.object({ name: z.string(), dateOfBirth: z.string() });
const PayDraftSchema = z.object({
  employmentType: z.enum(['HOURLY', 'SALARY_NO_OT', 'SALARY_WITH_OT']),
  annualSalaryPretax: z.number().nullable(),
  hourlyRate: z.number().nullable(),
  regularHoursPerWeek: z.number().nullable(),
  otThresholdHoursPerWeek: z.number().nullable(),
});
export type PersonDraft = z.infer<typeof PersonDraftSchema>;
export type PayDraft = z.infer<typeof PayDraftSchema>;

export const SetupProgressV2Schema = z.object({
  version: z.literal(2),
  /** Keyed stepId or `${stepId}:${role}` for per-person steps. */
  statuses: z.record(z.string(), StepStatusSchema),
  /** LITERAL gate answers — recorded only when a gate radio is actually
   *  submitted in the worded view (review M2). Statuses DERIVED from
   *  form-view Section actions never appear here, so "You said …" hints and
   *  control pre-selection can never fabricate an attribution. */
  gateAnswers: z.record(z.string(), z.enum(['yes', 'no'])),
  cursor: z.object({ stepId: z.string(), role: RoleSchema.optional() }).nullable(),
  /** Person bindings — patched on create / 1b reuse; resolved lazily (D-WF6). */
  bindings: z.object({ you: z.number().optional(), partner: z.number().optional() }),
  /** Transient pre-creation drafts (owner constraint 1) — form state, not a data copy. */
  drafts: z.object({
    you: PersonDraftSchema.optional(),
    partner: PersonDraftSchema.optional(),
    pay: z
      .object({ you: PayDraftSchema.optional(), partner: PayDraftSchema.optional() })
      .optional(),
  }),
  view: z.enum(['worded', 'form']),
  startedAt: z.string(),
});

export type SetupProgressV2 = Omit<z.infer<typeof SetupProgressV2Schema>, 'cursor'> & {
  cursor: { stepId: StepId; role?: Role } | null;
};

export function defaultProgressV2(view: 'worded' | 'form' = 'worded'): SetupProgressV2 {
  return {
    version: 2,
    statuses: {},
    gateAnswers: {},
    cursor: null,
    bindings: {},
    drafts: {},
    view,
    // Sanctioned wall-clock read (the shipped defaultProgress precedent).
    startedAt: new Date().toISOString(),
  };
}

// ── Visibility (shared by derivation AND the flow engine — single source) ───
export interface VisibilityInput {
  hasPartner: boolean;
  homeGateStatus: StepStatus;
  propertiesCount: number;
  housingPaymentsCount: number;
}

/** D-WF9: rent_gate shows after a home "no", or whenever rent rows exist. */
export function stepVisible(meta: StepMeta, role: Role | undefined, input: VisibilityInput): boolean {
  if (meta.perPerson && role === 'partner' && !input.hasPartner) return false;
  if (meta.id === 'rent_gate') {
    return input.homeGateStatus === 'skipped' || input.housingPaymentsCount > 0;
  }
  return true;
}

export function instanceKeysForPart(
  part: FlowPart,
  input: VisibilityInput,
  opts: { visibleOnly: boolean },
): string[] {
  const keys: string[] = [];
  for (const meta of STEP_ORDER) {
    if (meta.part !== part) continue;
    const roles: (Role | undefined)[] = meta.perPerson
      ? input.hasPartner ? ['you', 'partner'] : ['you']
      : [undefined];
    for (const role of roles) {
      if (opts.visibleOnly && !stepVisible(meta, role, input)) continue;
      keys.push(stepKey(meta.id, role));
    }
  }
  return keys;
}

export function sectionKeys(
  section: WizardSection,
  input: VisibilityInput,
  opts: { visibleOnly: boolean },
): string[] {
  return SECTION_TO_PARTS[section].flatMap((p) => instanceKeysForPart(p, input, opts));
}

// ── Section ↔ step derivation (both directions; design "Shared progress") ───
export function deriveSectionStatus(
  section: WizardSection,
  statuses: Record<string, StepStatus>,
  input: VisibilityInput,
): StepStatus {
  const st = sectionKeys(section, input, { visibleOnly: true }).map((k) => statuses[k] ?? 'pending');
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

/** Form-view advance: visible pending/in_progress → completed; skipped steps
 *  stay skipped; an all-skipped section stays skipped (v1 handleAdvance parity). */
export function applySectionAdvanced(
  p: SetupProgressV2, section: WizardSection, input: VisibilityInput,
): SetupProgressV2 {
  if (deriveSectionStatus(section, p.statuses, input) === 'skipped') return p;
  const statuses = { ...p.statuses };
  for (const k of sectionKeys(section, input, { visibleOnly: true })) {
    const cur = statuses[k] ?? 'pending';
    if (cur === 'pending' || cur === 'in_progress') statuses[k] = 'completed';
  }
  return { ...p, statuses };
}

/** Form-view entry-gate skip: ALL mapped steps skipped (spec, capital ALL). */
export function applySectionSkipped(
  p: SetupProgressV2, section: WizardSection, input: VisibilityInput,
): SetupProgressV2 {
  const statuses = { ...p.statuses };
  for (const k of sectionKeys(section, input, { visibleOnly: false })) statuses[k] = 'skipped';
  return { ...p, statuses };
}

/** ?section= promotion / entry-gate Start: pending|skipped → in_progress;
 *  never downgrades an answered step. */
export function applySectionPromoted(
  p: SetupProgressV2, section: WizardSection, input: VisibilityInput,
): SetupProgressV2 {
  const statuses = { ...p.statuses };
  for (const k of sectionKeys(section, input, { visibleOnly: true })) {
    const cur = statuses[k] ?? 'pending';
    if (cur === 'pending' || cur === 'skipped') statuses[k] = 'in_progress';
  }
  return { ...p, statuses };
}

// ── v1 → v2 migration ───────────────────────────────────────────────────────
const MIGRATION_INPUT: VisibilityInput = {
  hasPartner: false, homeGateStatus: 'pending', propertiesCount: 0, housingPaymentsCount: 0,
};

/** Pure localStorage transform (no entity access — D-WF5). Returns null on a
 *  corrupt v1 shape (caller falls back to defaults, matching the shipped
 *  loadProgress corrupt-shape behavior).
 *
 *  Known, accepted residue (review m1): the migration runs with
 *  hasPartner:false, so a TWO-person v1 household's completed Section 1
 *  migrates without partner step keys — the render-time deriver (which sees
 *  the real persons) reads Section 1 as in_progress, i.e. a badge downgrade
 *  plus a prefilled re-ask of the partner steps. Self-healing: the next
 *  Section-1 advance (form view) or partner-step completion (flow) writes
 *  the missing keys. No heal machinery by decision. */
export function migrateV1(parsed: unknown): SetupProgressV2 | null {
  const validStatus = (v: unknown): v is StepStatus =>
    v === 'pending' || v === 'in_progress' || v === 'completed' || v === 'skipped';
  if (typeof parsed !== 'object' || parsed === null) return null;
  const rec = parsed as { currentSection?: unknown; sectionStatus?: unknown; startedAt?: unknown };
  if (![1, 2, 3, 4].includes(rec.currentSection as number)) return null;
  const raw = rec.sectionStatus;
  if (typeof raw !== 'object' || raw === null) return null;
  if (![1, 2, 3, 4].every((i) => validStatus((raw as Record<number, unknown>)[i]))) return null;

  let p: SetupProgressV2 = {
    ...defaultProgressV2('form'), // D-WF4: a mid-run card-wizard user stays in the form view
    startedAt: typeof rec.startedAt === 'string' ? rec.startedAt : new Date().toISOString(),
    cursor: { stepId: FIRST_STEP_OF_SECTION[rec.currentSection as WizardSection] },
  };
  for (const section of [1, 2, 3, 4] as const) {
    const s = (raw as Record<number, StepStatus>)[section];
    if (s === 'completed') p = applySectionAdvanced(p, section, MIGRATION_INPUT);
    else if (s === 'skipped') p = applySectionSkipped(p, section, MIGRATION_INPUT);
    else if (s === 'in_progress') p = applySectionPromoted(p, section, MIGRATION_INPUT);
  }
  return p;
}

// ── Persistence ─────────────────────────────────────────────────────────────
/** Orphan pruning (spec resume rule): drop keys with unknown step ids, bad
 *  role tokens, or a role on a non-per-person step. Statuses of merely
 *  INVISIBLE steps are NOT orphans — they stay inert for branch-flip-back. */
function pruneOrphans(statuses: Record<string, StepStatus>): Record<string, StepStatus> {
  const out: Record<string, StepStatus> = {};
  for (const [k, v] of Object.entries(statuses)) {
    const parts = k.split(':');
    if (parts.length > 2) continue;
    const [id, role] = parts;
    if (!isStepId(id)) continue;
    const meta = stepMeta(id);
    if (role !== undefined && (!meta.perPerson || (role !== 'you' && role !== 'partner'))) continue;
    if (role === undefined && meta.perPerson) continue;
    out[k] = v;
  }
  return out;
}

/** Read-only except the one-time v1→v2 migration (which writes v2, deletes v1). */
export function loadSetupProgress(): SetupProgressV2 {
  try {
    const rawV2 = localStorage.getItem(SETUP_PROGRESS_V2_KEY);
    if (rawV2 !== null) {
      const parsed = SetupProgressV2Schema.safeParse(JSON.parse(rawV2));
      if (!parsed.success) return defaultProgressV2();
      const p = parsed.data;
      const cursor =
        p.cursor && isStepId(p.cursor.stepId)
          ? { stepId: p.cursor.stepId as StepId, ...(p.cursor.role ? { role: p.cursor.role } : {}) }
          : null;
      return { ...p, cursor, statuses: pruneOrphans(p.statuses) };
    }
    const rawV1 = localStorage.getItem(SETUP_PROGRESS_V1_KEY);
    if (rawV1 !== null) {
      const migrated = migrateV1(JSON.parse(rawV1));
      if (migrated !== null) {
        localStorage.setItem(SETUP_PROGRESS_V2_KEY, JSON.stringify(migrated));
        localStorage.removeItem(SETUP_PROGRESS_V1_KEY);
        return migrated;
      }
      // Corrupt v1: fall back to defaults, leave the key (shipped behavior parity).
      return defaultProgressV2();
    }
  } catch {
    // fall through to defaults
  }
  return defaultProgressV2();
}

export function saveSetupProgress(p: SetupProgressV2): void {
  try {
    localStorage.setItem(
      SETUP_PROGRESS_V2_KEY,
      JSON.stringify({ ...p, statuses: pruneOrphans(p.statuses) }),
    );
  } catch {
    // Best-effort, matching the shipped progress-persistence behavior.
  }
}

/** Removes BOTH progress keys. Called by the shared Finish (Task 10). */
export function clearSetupProgress(): void {
  try {
    localStorage.removeItem(SETUP_PROGRESS_V2_KEY);
    localStorage.removeItem(SETUP_PROGRESS_V1_KEY);
  } catch {
    // Best-effort.
  }
}

/** True while a wizard/flow run is mid-flight — v2 OR a leftover v1 key
 *  (design: "a leftover v1 key still counts as in-progress"). */
export function hasSetupInProgress(): boolean {
  try {
    return (
      localStorage.getItem(SETUP_PROGRESS_V2_KEY) !== null ||
      localStorage.getItem(SETUP_PROGRESS_V1_KEY) !== null
    );
  } catch {
    return false;
  }
}
