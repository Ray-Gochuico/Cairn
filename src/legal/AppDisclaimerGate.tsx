import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { DisclosureModal } from './DisclosureModal';
import { useDisclosureGate } from './useDisclosureGate';
import { DISCLOSURES } from './disclosures';

interface Props {
  children: ReactNode;
}

/**
 * Top-level gate for the app-wide disclaimer. Wraps the router so a
 * modal renders before the rest of the app on a version mismatch.
 *
 * Behavior:
 * - No household loaded yet → render children (first-run flow goes
 *   through Setup Wizard's Step 0 instead; we don't want to fight it).
 * - Household exists but disclaimerVersionAccepted is null → also
 *   render children (this is a first-runner mid-wizard; Step 0 catches
 *   them).
 * - Household has previously accepted SOME version, but the current
 *   DISCLOSURES.app_wide.version is newer → block with the modal,
 *   surfacing diffFromPrevious. The user cannot dismiss the modal
 *   without acknowledging.
 * - Already on the current version → render children.
 */
export function AppDisclaimerGate({ children }: Props) {
  const household = useHouseholdStore((s) => s.household);
  const load = useHouseholdStore((s) => s.load);
  const acceptDisclaimer = useHouseholdStore((s) => s.acceptDisclaimer);
  const gate = useDisclosureGate('app_wide');

  // Ensure household is loaded so the gate can decide. The store is
  // idempotent; only the first call hits the DB.
  useEffect(() => {
    if (!household) void load();
  }, [household, load]);

  // First-run users (no household yet, or never-accepted) — let the
  // Setup Wizard's Step 0 handle them. AppDisclaimerGate only
  // re-prompts users who have a recorded acceptance that's now stale.
  if (!household) return <>{children}</>;
  if (household.disclaimerVersionAccepted === null) return <>{children}</>;

  if (gate.state === 'ready') return <>{children}</>;

  // Version-bump re-prompt: block until acceptance.
  return (
    <DisclosureModal
      document={{
        ...gate.document,
        // Surface a default "what changed" affordance even if disclosures.ts
        // doesn't ship one — the user explicitly opted into v_old and is
        // now being asked to opt into v_new, so SOMETHING to read is
        // better than re-presenting an identical document.
        diffFromPrevious:
          gate.document.diffFromPrevious ??
          `You previously accepted version ${household.disclaimerVersionAccepted}. The current version is ${DISCLOSURES.app_wide.version}; please review and re-accept.`,
      }}
      continueLabel="Accept and continue"
      onAccept={async (version) => {
        await acceptDisclaimer('app_wide', version);
      }}
    />
  );
}

export default AppDisclaimerGate;
