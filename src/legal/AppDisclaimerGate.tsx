import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
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
 * The accepted version comes from the acceptances projection (the
 * boot-loaded mirror of disclosure_acceptances — single source of
 * truth, MF-1), not a household cache column (dropped in 0043).
 *
 * Behavior:
 * - No household loaded yet → render children (first-run flow goes
 *   through Setup Wizard's Step 0 instead; we don't want to fight it).
 * - While the acceptances projection is loading → render a brief calm
 *   loading state, never the (possibly un-consented) children.
 * - On a load error → FAIL CLOSED and re-present the app_wide disclosure
 *   (we cannot prove the user accepted; assuming first-run would fail
 *   open for a returning user owed a re-prompt — TR-2, Legal M1).
 * - Otherwise no recorded app_wide acceptance = first-run → render
 *   children (Setup Wizard's Step 0 owns the initial acceptance).
 * - Recorded app_wide acceptance but the current version is newer →
 *   block with the modal, surfacing diffFromPrevious. The user cannot
 *   dismiss the modal without acknowledging.
 * - Already on the current version → render children.
 */
export function AppDisclaimerGate({ children }: Props) {
  const household = useHouseholdStore((s) => s.household);
  const load = useHouseholdStore((s) => s.load);
  const acceptDisclaimer = useHouseholdStore((s) => s.acceptDisclaimer);
  const loadAcceptances = useAcceptancesStore((s) => s.load);
  const acceptancesStatus = useAcceptancesStore((s) => s.status);
  const appWideAccepted = useAcceptancesStore((s) => s.acceptedVersions.app_wide ?? null);
  const gate = useDisclosureGate('app_wide');

  // Ensure household is loaded so the gate can decide. The store is
  // idempotent; only the first call hits the DB.
  useEffect(() => {
    if (!household) void load();
  }, [household, load]);

  // Boot-load the acceptances projection so the gate reads from memory.
  useEffect(() => {
    void loadAcceptances();
  }, [loadAcceptances]);

  // First-run users (no household yet) — let the Setup Wizard's Step 0
  // handle them. AppDisclaimerGate only re-prompts users who have a
  // recorded acceptance that's now stale.
  if (!household) return <>{children}</>;

  // The projection is still loading — render a brief calm loading state,
  // never the (possibly un-consented) children.
  if (acceptancesStatus === 'loading') {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  // FAIL CLOSED: the load errored, so we cannot prove the user has accepted.
  // Re-present the app_wide disclosure rather than assume first-run. (The
  // re-prompt modal below renders for `status === 'error'` and for a stale/
  // mismatched accepted version alike.)
  if (acceptancesStatus !== 'error' && appWideAccepted === null) {
    // Genuine first run (load succeeded, no app_wide row): let the Setup
    // Wizard own the initial acceptance.
    return <>{children}</>;
  }

  if (gate.state === 'ready') return <>{children}</>;

  // Version-bump re-prompt: block until acceptance.
  return (
    <DisclosureModal
      document={{
        ...gate.document,
        // Surface a default "what changed" affordance even if disclosures.ts
        // doesn't ship one — the user explicitly opted into v_old and is
        // now being asked to opt into v_new, so SOMETHING to read is
        // better than re-presenting an identical document. On the error
        // path appWideAccepted may be null — render the generic re-accept
        // copy in that case.
        diffFromPrevious:
          gate.document.diffFromPrevious ??
          (appWideAccepted
            ? `You previously accepted version ${appWideAccepted}. The current version is ${DISCLOSURES.app_wide.version}; please review and re-accept.`
            : `Please review and accept the current disclaimer (version ${DISCLOSURES.app_wide.version}) to continue.`),
      }}
      continueLabel="Accept and continue"
      onAccept={async (version) => {
        await acceptDisclaimer('app_wide', version);
      }}
    />
  );
}

export default AppDisclaimerGate;
