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
 * Precedence (each branch short-circuits):
 * - No household loaded yet → render children (first-run flow goes
 *   through Setup Wizard's Step 0 instead; we don't want to fight it).
 * - Acceptances projection still loading → render a brief calm loading
 *   state, never the (possibly un-consented) children.
 * - Load error → FAIL CLOSED: re-present the app_wide disclosure
 *   UNCONDITIONALLY. This wins over a cached `gate.state === 'ready'`:
 *   the store's catch sets `status: 'error'` without clearing
 *   `acceptedVersions`, so a returning user whose prior successful load
 *   cached the current version must NOT be let in on an errored boot
 *   (we cannot prove acceptance this load — TR-2, Legal M1).
 * - ready && no recorded app_wide acceptance = first-run → render
 *   children (Setup Wizard's Step 0 owns the initial acceptance).
 * - ready && accepted version matches current → render children.
 * - Otherwise (ready && stale version, or error) → block with the modal,
 *   surfacing diffFromPrevious. The user cannot dismiss without accepting.
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

  // FAIL CLOSED BY CONSTRUCTION: on a load error we cannot prove the user
  // has accepted, so re-present the app_wide disclosure — UNCONDITIONALLY.
  // This MUST short-circuit before the `gate.state === 'ready'` check below:
  // the store's catch sets `status: 'error'` WITHOUT clearing
  // `acceptedVersions`, so a stale-but-current cached value from a prior
  // successful load could otherwise make the gate read `ready` and render
  // un-consented children on this errored boot. Handling error here closes
  // that structurally (the modal renders the generic re-accept copy since we
  // can't trust appWideAccepted on this path).
  if (acceptancesStatus !== 'error' && appWideAccepted === null) {
    // Genuine first run (load succeeded, no app_wide row): let the Setup
    // Wizard own the initial acceptance.
    return <>{children}</>;
  }

  // status === 'ready' with a matching accepted version → let the user in.
  // (On status === 'error' we deliberately do NOT honor a `ready` gate —
  // the error guard above means we only reach here on 'ready'/'error', and
  // an errored read must fall through to the modal regardless of the cached
  // gate.state.)
  if (acceptancesStatus === 'ready' && gate.state === 'ready') return <>{children}</>;

  // Resolve the document to present. `gate.document` exists only on
  // `needs-acceptance`; on the fail-closed error path the gate may read
  // `ready` (a stale-but-current cached version), so fall back to the
  // app_wide registry entry rather than dereference a missing `gate.document`.
  const baseDocument =
    gate.state === 'needs-acceptance'
      ? gate.document
      : { id: 'app_wide' as const, ...DISCLOSURES.app_wide };

  // Version-bump re-prompt OR fail-closed error re-prompt: block until acceptance.
  return (
    <DisclosureModal
      document={{
        ...baseDocument,
        // Surface a default "what changed" affordance even if disclosures.ts
        // doesn't ship one — the user explicitly opted into v_old and is
        // now being asked to opt into v_new, so SOMETHING to read is
        // better than re-presenting an identical document. On the error
        // path appWideAccepted may be null — render the generic re-accept
        // copy in that case.
        diffFromPrevious:
          baseDocument.diffFromPrevious ??
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
