import { useHouseholdStore } from '@/stores/household-store';
import { DISCLOSURES, type DisclosureId, type DisclosureDocument } from './disclosures';

export type GateResult =
  | { state: 'ready' }
  | {
      state: 'needs-acceptance';
      document: DisclosureDocument & { id: DisclosureId };
    };

/**
 * Returns whether the household has accepted the *current* version of
 * the given disclosure. Components mount the matching modal when state
 * is `needs-acceptance`.
 *
 * The hook reads from `household-store` (the fast-path cache populated
 * by `acceptDisclaimer`); it does NOT touch the audit table. If the
 * household hasn't loaded yet, returns `needs-acceptance` — caller
 * must decide whether to gate UI on that or wait for the household to
 * resolve (AppDisclaimerGate, for example, short-circuits when the
 * household is null because the wizard will handle first-run).
 */
export function useDisclosureGate(id: DisclosureId): GateResult {
  const acceptedVersion = useHouseholdStore((s) => {
    if (!s.household) return null;
    return id === 'app_wide'
      ? s.household.disclaimerVersionAccepted
      : s.household.roadmapDisclaimerVersionAccepted;
  });
  const current = DISCLOSURES[id];

  if (acceptedVersion === current.version) {
    return { state: 'ready' };
  }
  return {
    state: 'needs-acceptance',
    document: { id, ...current },
  };
}
