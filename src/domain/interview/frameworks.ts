import type { Person } from '@/types/schema';

export type FrameworkId = 'conservative' | 'moderate' | 'aggressive';
/** How a policy treats the mid-rate band (B5): fill fully / 50-50 with invest / minimums only. */
export type MidRateTreatment = 'fill' | 'half' | 'minimums';

export interface FrameworkPolicy {
  id: FrameworkId;
  name: string;
  epithet: string; // CI-4
  efMultiple: (persons: Person[]) => { multiple: 3 | 6; assumed: boolean };
  midRate: MidRateTreatment;
}

/**
 * D-GI5 (design §3.2, stricter than the roadmap's household resolver on
 * purpose): 3× iff EVERY person answered 'stable'; any 'unstable' OR any
 * unanswered → 6×. `assumed` is true only when the 6× came from an
 * unanswered person (drives CI-26 + the inline write-through question),
 * never when someone explicitly answered 'unstable'.
 */
export function moderateEfMultiple(persons: Person[]): { multiple: 3 | 6; assumed: boolean } {
  const everyStable = persons.length > 0 && persons.every((p) => p.jobStability === 'stable');
  if (everyStable) return { multiple: 3, assumed: false };
  const anyUnstable = persons.some((p) => p.jobStability === 'unstable');
  return { multiple: 6, assumed: !anyUnstable };
}

/** Design §3.2 — the ENTIRE policy content. No runtime judgment anywhere else. */
export const FRAMEWORKS: readonly FrameworkPolicy[] = [
  { id: 'conservative', name: 'Conservative', epithet: 'Safety first.',
    efMultiple: () => ({ multiple: 6, assumed: false }), midRate: 'fill' },
  { id: 'moderate', name: 'Moderate', epithet: 'The standard order.',
    efMultiple: moderateEfMultiple, midRate: 'half' },
  { id: 'aggressive', name: 'Aggressive', epithet: 'Growth-weighted.',
    efMultiple: () => ({ multiple: 3, assumed: false }), midRate: 'minimums' },
] as const;

export function frameworkById(id: FrameworkId): FrameworkPolicy {
  const p = FRAMEWORKS.find((f) => f.id === id);
  if (!p) throw new Error(`interview: unknown framework '${id}'`);
  return p;
}
