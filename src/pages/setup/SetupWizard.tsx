import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Step0Disclaimer from './Step0Disclaimer';
import SectionLayout from './SectionLayout';
import { DISCLOSURES } from '@/legal/disclosures';
import { useHouseholdStore } from '@/stores/household-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { usePersonsStore } from '@/stores/persons-store';
import type { SectionIndex } from './sections';

/**
 * Setup wizard route handler. Gates the new SectionLayout behind the
 * app-wide disclaimer; pre-onboarded users with persons can deep-link
 * to a specific section via ?section= (e.g. Settings → Advanced opens
 * Section 4 for bulk import workflows).
 *
 * Disclaimer acceptance: recorded in disclosure_acceptances (the single
 * source of truth, MF-1) via Step0Disclaimer → useHouseholdStore.accept-
 * Disclaimer; read here through the acceptances projection, not a
 * household column. For users opening /setup?section=4 from Settings,
 * persons.length > 0 proves they've already onboarded once, so the
 * disclaimer is bypassed even if the accepted version differs
 * (cross-launch this is rare; AppDisclaimerGate handles re-acceptance
 * app-wide).
 */
export default function SetupWizard() {
  const [searchParams] = useSearchParams();
  const household = useHouseholdStore((s) => s.household);
  const loadHousehold = useHouseholdStore((s) => s.load);
  const appWideAccepted = useAcceptancesStore((s) => s.acceptedVersions.app_wide ?? null);
  const loadAcceptances = useAcceptancesStore((s) => s.load);
  const persons = usePersonsStore((s) => s.persons);
  const loadPersons = usePersonsStore((s) => s.load);
  const [stepZeroAccepted, setStepZeroAccepted] = useState(false);

  useEffect(() => {
    if (!household) void loadHousehold();
  }, [household, loadHousehold]);
  useEffect(() => {
    void loadAcceptances();
  }, [loadAcceptances]);
  useEffect(() => {
    void loadPersons();
  }, [loadPersons]);

  const queryParamSection = (() => {
    const raw = searchParams.get('section');
    if (raw == null) return undefined;
    const n = Number(raw);
    if (![1, 2, 3, 4].includes(n)) return undefined;
    return n as SectionIndex;
  })();

  const personsExist = persons.length > 0;

  const disclaimerSatisfied =
    stepZeroAccepted ||
    appWideAccepted === DISCLOSURES.app_wide.version;

  // Existing-household users with a section= param bypass the disclaimer
  // — they've onboarded before and just want to reach a specific section.
  const showDisclaimer =
    !disclaimerSatisfied &&
    !(personsExist && queryParamSection !== undefined);

  if (showDisclaimer) {
    return (
      <Step0Disclaimer onComplete={() => setStepZeroAccepted(true)} />
    );
  }

  // Section param only applies when there's an existing household; on a
  // truly fresh first-run we always start at Section 1.
  const initialSection =
    queryParamSection !== undefined && personsExist
      ? queryParamSection
      : undefined;

  return <SectionLayout initialSection={initialSection} />;
}
