import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  SECTIONS,
  type SectionIndex,
  type SectionStatus,
} from './sections';
import Section1_WhoYouAre from './Section1_WhoYouAre';
import Section2_WhatYouOwn from './Section2_WhatYouOwn';
import Section3_WhatYouOwe from './Section3_WhatYouOwe';
import Section4_History from './Section4_History';
import { markSetupDismissed } from '@/lib/setup-dismissal';
import { isTailorDone } from '@/lib/onboarding-state';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useLoansStore } from '@/stores/loans-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useGoalsStore } from '@/stores/goals-store';

const STORAGE_KEY = 'setupWizard.progress.v1';

interface Progress {
  currentSection: SectionIndex;
  sectionStatus: Record<SectionIndex, SectionStatus>;
  startedAt: string;
}

function defaultProgress(): Progress {
  return {
    currentSection: 1,
    sectionStatus: { 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending' },
    startedAt: new Date().toISOString(),
  };
}

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaultProgress();
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      ![1, 2, 3, 4].includes(parsed.currentSection)
    ) {
      return defaultProgress();
    }
    return parsed as Progress;
  } catch {
    return defaultProgress();
  }
}

interface Props {
  /** Optional initial section override (used by ?section= in SetupWizard). */
  initialSection?: SectionIndex;
}

export default function SectionLayout({ initialSection }: Props) {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<Progress>(() => {
    const p = loadProgress();
    if (initialSection !== undefined) p.currentSection = initialSection;
    return p;
  });

  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }, [progress]);

  // M2 (a11y): on section change, move focus to the section heading so
  // screen-reader and keyboard users get a landmark instead of stranding focus
  // on a just-unmounted "Next/Previous section" button.
  useEffect(() => {
    headingRef.current?.focus();
  }, [progress.currentSection]);

  const setStatus = useCallback(
    (idx: SectionIndex, status: SectionStatus) => {
      setProgress((prev) => {
        const next = {
          ...prev,
          sectionStatus: { ...prev.sectionStatus, [idx]: status },
        };
        // Smoke-test 2026-05-27 finding: clicking "Skip — none of this
        // applies" on the SectionEntryGate marked the section as skipped
        // but didn't advance the wizard. Users had to also click "Next
        // section" at the bottom, which read as the skip not working.
        // Treat skipping the CURRENT section as a one-click advance —
        // they're saying "none of this applies, move on". Re-skipping a
        // non-current section (rare; user clicking back) stays put.
        if (status === 'skipped' && idx === prev.currentSection && idx < 4) {
          next.currentSection = (idx + 1) as SectionIndex;
        }
        return next;
      });
    },
    [],
  );

  const goToSection = useCallback((idx: SectionIndex) => {
    setProgress((prev) => ({ ...prev, currentSection: idx }));
  }, []);

  const handleAdvance = useCallback(() => {
    const cur = progress.currentSection;
    if (cur === 4) return;
    setProgress((prev) => ({
      ...prev,
      sectionStatus: {
        ...prev.sectionStatus,
        [cur]:
          prev.sectionStatus[cur] === 'skipped' ? 'skipped' : 'completed',
      },
      currentSection: (cur + 1) as SectionIndex,
    }));
  }, [progress.currentSection]);

  const handleFinish = useCallback(() => {
    // Persist an explicit "setup finished" marker so the first-launch redirect
    // (main.tsx) does NOT loop a zero-persons user back to /setup (H1). This
    // is independent of clearing the wizard progress below.
    markSetupDismissed();
    localStorage.removeItem(STORAGE_KEY);
    // New users go into the post-setup onboarding flow at /welcome; existing
    // users who re-enter the wizard via /setup?section=4 (Tailor already done)
    // go straight to the Dashboard — the guard prevents re-running onboarding.
    navigate(isTailorDone() ? '/' : '/welcome');
  }, [navigate]);

  const currentSection = progress.currentSection;
  const currentMeta = SECTIONS[currentSection - 1];

  // H3: green "✓ done" should imply data exists. Derive, per section, whether
  // the user actually wrote at least one entity (from the same stores each
  // section loads). A section marked `completed` but with no data gets a
  // neutral "visited" badge instead — the persisted `skipped` state keeps its
  // own "↩ skipped" badge. Household has a default singleton row, so Section 1
  // keys off the user-entered persons/dependents, not household.
  const personsCount = usePersonsStore((s) => s.persons.length);
  const dependentsCount = useDependentsStore((s) => s.dependents.length);
  const accountsCount = useAccountsStore((s) => s.accounts.length);
  const holdingsCount = useHoldingsStore((s) => s.holdings.length);
  const propertiesCount = usePropertiesStore((s) => s.properties.length);
  const vehiclesCount = useVehiclesStore((s) => s.vehicles.length);
  const housingPaymentsCount = useHousingPaymentsStore(
    (s) => s.housingPayments.length,
  );
  const vehicleLeasesCount = useVehicleLeasesStore(
    (s) => s.vehicleLeases.length,
  );
  const equityGrantsCount = useEquityGrantsStore((s) => s.equityGrants.length);
  const loansCount = useLoansStore((s) => s.loans.length);
  const snapshotsCount = useSnapshotsStore((s) => s.snapshots.length);
  const assetValueSnapshotsCount = useAssetValueSnapshotsStore(
    (s) => s.assetValueSnapshots.length,
  );
  const contributionsCount = useContributionsStore(
    (s) => s.contributions.length,
  );
  const transactionsCount = useTransactionsStore((s) => s.transactions.length);
  const goalsCount = useGoalsStore((s) => s.goals.length);

  const sectionHasData: Record<SectionIndex, boolean> = {
    1: personsCount > 0 || dependentsCount > 0,
    2:
      accountsCount > 0 ||
      holdingsCount > 0 ||
      propertiesCount > 0 ||
      vehiclesCount > 0 ||
      housingPaymentsCount > 0 ||
      vehicleLeasesCount > 0 ||
      equityGrantsCount > 0,
    3: loansCount > 0,
    4:
      snapshotsCount > 0 ||
      assetValueSnapshotsCount > 0 ||
      contributionsCount > 0 ||
      transactionsCount > 0 ||
      goalsCount > 0,
  };

  const sectionContent = useMemo(() => {
    const props = {
      status: progress.sectionStatus[currentSection],
      onSetStatus: (s: SectionStatus) => setStatus(currentSection, s),
    };
    switch (currentSection) {
      case 1:
        return <Section1_WhoYouAre {...props} />;
      case 2:
        return <Section2_WhatYouOwn {...props} />;
      case 3:
        return <Section3_WhatYouOwe {...props} />;
      case 4:
        return <Section4_History {...props} />;
    }
  }, [currentSection, progress.sectionStatus, setStatus]);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <nav
        aria-label="Setup progress"
        className="flex items-center gap-2"
      >
        {SECTIONS.map((s) => {
          const status = progress.sectionStatus[s.index];
          const isCurrent = s.index === currentSection;
          const clickable =
            status === 'completed' ||
            status === 'skipped' ||
            isCurrent;
          // "✓ done" (green) only when the section is completed AND has data;
          // a completed-but-empty section reads as neutral "visited" (H3).
          const doneWithData = status === 'completed' && sectionHasData[s.index];
          const visitedEmpty = status === 'completed' && !sectionHasData[s.index];
          return (
            <button
              key={s.index}
              type="button"
              onClick={() => clickable && goToSection(s.index)}
              disabled={!clickable}
              className={`flex-1 text-xs py-2 px-2 rounded border text-left ${
                isCurrent
                  ? 'border-primary bg-primary/5 font-medium'
                  : doneWithData
                    ? 'border-success/40 text-success'
                    : status === 'completed' || status === 'skipped'
                      ? 'border-muted-foreground/30 text-muted-foreground'
                      : 'border-muted-foreground/20 text-muted-foreground'
              }`}
            >
              <div className="font-medium">Section {s.index}</div>
              <div>{s.label}</div>
              {doneWithData && (
                <div className="text-[10px] mt-0.5">✓ done</div>
              )}
              {visitedEmpty && (
                <div className="text-[10px] mt-0.5">visited</div>
              )}
              {status === 'skipped' && (
                <div className="text-[10px] mt-0.5">↩ skipped</div>
              )}
            </button>
          );
        })}
      </nav>

      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold outline-none"
      >
        Section {currentSection} of 4 — {currentMeta.label}
      </h1>

      {sectionContent}

      <div className="flex items-center justify-between pt-6 border-t">
        <Button
          type="button"
          variant="outline"
          disabled={currentSection === 1}
          onClick={() =>
            goToSection((currentSection - 1) as SectionIndex)
          }
        >
          Previous section
        </Button>
        {currentSection === 4 ? (
          <Button type="button" onClick={handleFinish}>
            Finish setup
          </Button>
        ) : (
          <Button type="button" onClick={handleAdvance}>
            Next section
          </Button>
        )}
      </div>
    </div>
  );
}
