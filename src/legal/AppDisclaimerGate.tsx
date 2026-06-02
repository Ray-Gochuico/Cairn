import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { DisclosureModal } from './DisclosureModal';
import { useDisclosureGate } from './useDisclosureGate';
import { DISCLOSURES } from './disclosures';
import { Button } from '@/components/ui/button';

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
 * - No household AND no household-load error → genuine first run: render
 *   children (the first-run flow goes through Setup Wizard's Step 0 instead;
 *   we don't want to fight it).
 * - No household BUT the household store reported an error → FAIL CLOSED
 *   (Frontend M1). A household-LOAD FAILURE also lands on `household === null`,
 *   and we must NOT treat that as first-run: we cannot prove the user is a
 *   genuine first-runner (vs. a returning user whose settings failed to load),
 *   so re-present the disclosure rather than bypass it — mirroring the
 *   acceptances-store fail-closed path below.
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
  const householdError = useHouseholdStore((s) => s.error);
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

  // Latch the last RESOLVED status. The acceptances store is shared, and a
  // child rendered BELOW this gate (TodaysTriviaCard, Learn, the Setup Wizard)
  // calling load() on mount flips the shared status back to 'loading'. If we
  // hid already-admitted children on that transient, the child would unmount,
  // remount once the load resolves, re-trigger load(), and loop — saturating
  // the main thread (and, under `tauri dev`, tripping Vite into reload cycles
  // that orphan in-flight SQL IPC callbacks). So once we've resolved at least
  // once, treat a transient 'loading' as the prior resolved status; the bare
  // loading screen shows ONLY on the very first load. acceptedVersions is not
  // cleared during a re-load, so the prior decision stays correct until the
  // read genuinely re-resolves.
  const lastResolved = useRef<'ready' | 'error' | null>(null);
  if (acceptancesStatus === 'ready' || acceptancesStatus === 'error') {
    lastResolved.current = acceptancesStatus;
  }
  const effectiveStatus =
    acceptancesStatus === 'loading' && lastResolved.current !== null
      ? lastResolved.current
      : acceptancesStatus;

  // GENUINE first-run (no household AND no household-load error) — let the
  // Setup Wizard's Step 0 handle the initial acceptance. AppDisclaimerGate
  // only re-prompts users who have a recorded acceptance that's now stale.
  if (!household && !householdError) return <>{children}</>;

  // FAIL CLOSED on a household-LOAD failure (Frontend M1). A failed
  // household.load() also yields `household === null`, which the branch above
  // would otherwise misread as first-run and let un-consented children through.
  // We cannot tell a returning user (whose settings simply failed to load) from
  // a genuine first-runner, so we must not bypass the disclaimer. We block with
  // a calm, reassuring state rather than the ACCEPT modal: accepting wouldn't
  // clear the household error, so the modal would re-present in a loop. The
  // correct recovery is to re-run the household load().
  //
  // Guard on `!household` specifically: an `update()` failure also sets the
  // store's `error` but KEEPS the loaded household, and we must NOT block the
  // whole app on a settings-SAVE hiccup (that's surfaced inline at the form).
  // Only a LOAD failure (error set AND no household) trips this fail-closed.
  if (!household && householdError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-lg font-semibold">We couldn’t verify your settings</h1>
          <p className="text-sm text-muted-foreground">
            Your data is safe — we just couldn’t load your household profile, so we
            can’t confirm which disclosures you’ve accepted. Reload to try again.
          </p>
          <Button type="button" onClick={() => void load()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }

  // The projection is still loading for the FIRST time — render a brief calm
  // loading state, never the (possibly un-consented) children. (A re-load after
  // the first resolution is latched above, so it does not re-enter this state.)
  if (effectiveStatus === 'loading') {
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
  if (effectiveStatus !== 'error' && appWideAccepted === null) {
    // Genuine first run (load succeeded, no app_wide row): let the Setup
    // Wizard own the initial acceptance.
    return <>{children}</>;
  }

  // status === 'ready' with a matching accepted version → let the user in.
  // (On status === 'error' we deliberately do NOT honor a `ready` gate —
  // the error guard above means we only reach here on 'ready'/'error', and
  // an errored read must fall through to the modal regardless of the cached
  // gate.state.)
  if (effectiveStatus === 'ready' && gate.state === 'ready') return <>{children}</>;

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
