import { DisclosureModal } from '@/legal/DisclosureModal';
import { DISCLOSURES } from '@/legal/disclosures';
import { useHouseholdStore } from '@/stores/household-store';

interface Props {
  onComplete: () => void;
}

/**
 * Setup Wizard Step 0 — the app-wide disclaimer. Renders as a full-screen
 * modal that the user cannot dismiss without acknowledging. On accept,
 * writes the household cache + disclosure_acceptances audit row and
 * advances the wizard.
 *
 * This is the gate for first-run users (no household.disclaimer_*
 * columns set). Returning users with stale versions are caught earlier
 * by AppDisclaimerGate at app boot — by the time they reach the wizard,
 * the current version is already accepted, so Step 0 is a no-op if it
 * even renders.
 */
export function Step0Disclaimer({ onComplete }: Props) {
  const acceptDisclaimer = useHouseholdStore((s) => s.acceptDisclaimer);

  return (
    <DisclosureModal
      document={{ id: 'app_wide', ...DISCLOSURES.app_wide }}
      continueLabel="Continue to setup"
      onAccept={async (version) => {
        await acceptDisclaimer('app_wide', version);
        onComplete();
      }}
    />
  );
}

export default Step0Disclaimer;
