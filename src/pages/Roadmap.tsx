import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDisclosureGate } from '@/legal/useDisclosureGate';
import { DisclosureModal } from '@/legal/DisclosureModal';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useLoansStore } from '@/stores/loans-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import { useRoadmap } from '@/domain/roadmap/context';
import { evaluate } from '@/domain/roadmap/evaluate';
import { NODES } from '@/domain/roadmap/nodes';
import { DisclosureBanner } from '@/components/roadmap/DisclosureBanner';
import { NextMoveHero } from '@/components/roadmap/NextMoveHero';
import { SectionCard } from '@/components/roadmap/SectionCard';
import { StatusLegend } from '@/components/roadmap/StatusIcon';

const SECTIONS = [0, 1, 2, 3, 4, 5, 6] as const;
const SECTION_TITLES: Record<(typeof SECTIONS)[number], string> = {
  0: 'Budget and Essentials',
  1: 'Employer Match & Emergency Fund',
  2: 'Debt Reduction',
  3: 'HSA',
  4: 'IRA',
  5: 'Additional Savings',
  6: 'After-Tax & Taxable',
};

/**
 * Optional glossary key per section. When set, the SectionCard header
 * carries a native `title` attribute sourced from src/lib/glossary.ts —
 * matches the Sidebar pattern (proper-noun label visible, hover/tap reveals
 * a short definition). HSA, IRA, and After-Tax & Taxable carry hints;
 * the wordier "Employer Match & Emergency Fund" / "Additional Savings"
 * are self-explanatory.
 */
const SECTION_GLOSSARY: Partial<Record<(typeof SECTIONS)[number], string>> = {
  3: 'HSA',
  4: 'IRA',
  6: 'After-Tax & Taxable',
};

/**
 * Roadmap page. Wraps the actual content behind a roadmap-specific
 * disclosure gate so a user who has accepted the app-wide disclaimer
 * still has to opt into the educational chart's caveats before they see
 * any computed status badges. Once accepted, renders the persistent
 * banner, the NextMoveHero, and seven collapsible SectionCards.
 *
 * The page kicks off store loads for every dataset the rule engine
 * reads. Stores are idempotent and cheap, so re-mounting the page is
 * safe; downstream selectors only re-render when their slice changes.
 */
export default function Roadmap() {
  const navigate = useNavigate();
  const gate = useDisclosureGate('roadmap');
  const acceptDisclaimer = useHouseholdStore((s) => s.acceptDisclaimer);

  const loadHousehold = useHouseholdStore((s) => s.load);
  const loadPersons = usePersonsStore((s) => s.load);
  const loadAccounts = useAccountsStore((s) => s.load);
  const loadLoans = useLoansStore((s) => s.load);
  const loadContributions = useContributionsStore((s) => s.load);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const loadTransactions = useTransactionsStore((s) => s.load);
  const loadOverrides = useRoadmapOverridesStore((s) => s.load);

  useEffect(() => {
    void loadHousehold();
    void loadPersons();
    void loadAccounts();
    void loadLoans();
    void loadContributions();
    void loadSnapshots();
    void loadTransactions();
    void loadOverrides();
  }, [
    loadHousehold,
    loadPersons,
    loadAccounts,
    loadLoans,
    loadContributions,
    loadSnapshots,
    loadTransactions,
    loadOverrides,
  ]);

  const ctx = useRoadmap();
  const household = useHouseholdStore((s) => s.household);
  const results = useMemo(
    () => (ctx ? evaluate(ctx) : new Map()),
    [ctx],
  );

  // If the household hasn't loaded yet, surface a setup prompt — the
  // disclosure gate would otherwise fire on a null household (because
  // the accepted-version selector returns null) and trap a first-run
  // user behind a modal before the wizard ran. The wizard owns first
  // run, not the Roadmap.
  if (!household) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="text-sm text-muted-foreground">
          Set up your household to see your Roadmap.
        </div>
      </div>
    );
  }

  if (gate.state === 'needs-acceptance') {
    return (
      <DisclosureModal
        document={gate.document}
        continueLabel="Open Roadmap"
        onAccept={(v) => acceptDisclaimer('roadmap', v)}
        onCancel={() => navigate('/')}
      />
    );
  }

  if (!ctx) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="text-sm text-muted-foreground">
          Set up your household to see your Roadmap.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <DisclosureBanner />
      <NextMoveHero results={results} />
      {/* Status legend explains the six possible node-status icons. Lives
          above the section cards so users have an at-a-glance reference
          before they start scanning rows. W7-UX MF-2. */}
      <StatusLegend />
      {SECTIONS.map((s) => (
        <SectionCard
          key={s}
          section={s}
          title={SECTION_TITLES[s]}
          glossaryTerm={SECTION_GLOSSARY[s]}
          nodes={NODES.filter((n) => n.section === s)}
          results={results}
          ctx={ctx}
        />
      ))}
    </div>
  );
}
