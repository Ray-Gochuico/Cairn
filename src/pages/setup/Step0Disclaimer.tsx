import { DisclosureModal } from '@/legal/DisclosureModal';
import { DISCLOSURES } from '@/legal/disclosures';
import { useHouseholdStore } from '@/stores/household-store';

interface Props {
  onComplete: () => void;
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
function Step0Disclaimer({ onComplete }: Props) {
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
      onAccept={async (version) => {
        await acceptDisclaimer('app_wide', version);
        onComplete();
      }}
    />
  );
}

export default Step0Disclaimer;
