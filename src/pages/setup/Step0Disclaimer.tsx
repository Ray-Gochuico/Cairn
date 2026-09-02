import { DisclosureModal } from '@/legal/DisclosureModal';
import { DISCLOSURES } from '@/legal/disclosures';
import { useHouseholdStore } from '@/stores/household-store';
import { enterExploreMode } from '@/lib/explore-transitions';

interface Props {
  onComplete: () => void;
  /**
   * W4 (D-S7): fired `true` the moment the explore entry starts and `false`
   * if it fails. Recording the app_wide acceptance flips the wizard's
   * `disclaimerSatisfied` predicate, which would swap Step 0 for FlowShell in
   * the instant before `window.location.assign('/')` commits — and FlowShell's
   * mount effect WRITES the real `setupWizard.progress.v2` key. The parent
   * holds Step 0 mounted while this is true, so no real device-local key is
   * ever written on the way into the sample profile.
   */
  onExploreEntering?: (entering: boolean) => void;
}

/**
 * Setup Wizard Step 0 — the app-wide disclaimer. Renders as a full-screen
 * modal that the user cannot dismiss without acknowledging. On accept,
 * appends the disclosure_acceptances audit row (the single source of
 * truth, MF-1) and advances the wizard.
 *
 * This is the gate for first-run users (no recorded app_wide acceptance).
 * Returning users with stale versions are caught earlier by
 * AppDisclaimerGate at app boot — by the time they reach the wizard, the
 * current version is already accepted, so Step 0 is a no-op if it even
 * renders.
 */
function Step0Disclaimer({ onComplete, onExploreEntering }: Props) {
  const acceptDisclaimer = useHouseholdStore((s) => s.acceptDisclaimer);

  // First-run path — the user has nothing to "diff from." Build a
  // first-run document that drops diffFromPrevious so the modal doesn't
  // surface a confusing "what changed since you last accepted" banner
  // to someone who hasn't accepted anything yet. Re-prompts come through
  // AppDisclaimerGate, which DOES preserve diffFromPrevious — see
  // that file.
  const firstRunDoc = {
    id: 'app_wide' as const,
    version: DISCLOSURES.app_wide.version,
    title: DISCLOSURES.app_wide.title,
    body: DISCLOSURES.app_wide.body,
    acceptanceCheckboxLabel: DISCLOSURES.app_wide.acceptanceCheckboxLabel,
  };

  return (
    <DisclosureModal
      document={firstRunDoc}
      continueLabel="Continue to setup"
      heroHeader={
        <div className="px-6 pt-6 pb-2">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Cairn</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A local-first financial planner — everything stays on this machine.
            One thing to read before you start:
          </p>
        </div>
      }
      onAccept={async (version) => {
        await acceptDisclaimer('app_wide', version);
        onComplete();
      }}
      secondaryAction={{
        label: 'Explore with sample data first',
        helper: 'See a filled-in Cairn before entering your own numbers.',
        busyLabel: 'Opening sample data…',
        onSelect: async () => {
          // 0. Hold Step 0 mounted for the whole transition (see the prop's
          //    doc comment) — otherwise step 1 flips the wizard to FlowShell,
          //    which writes the REAL setupWizard.progress.v2 key.
          onExploreEntering?.(true);
          try {
            // 1. Acceptance on the REAL DB — the same write path the primary
            //    action uses; the flag is not set yet, so getDatabase() is real.
            await acceptDisclaimer('app_wide', firstRunDoc.version);
            // 2. close (flush) → flag → navigate('/'): explore boot takes over.
            //    The seed then writes the app_wide acceptance into the SAMPLE
            //    DB at the registry version — justified because the flag is
            //    only ever set after this genuine acceptance (D-S3).
            await enterExploreMode();
          } catch (e) {
            onExploreEntering?.(false); // release the hold; the modal shows the error
            throw e;
          }
        },
      }}
    />
  );
}

export default Step0Disclaimer;
