import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/EmptyState';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import PageLoadingSpinner from '@/components/layout/PageLoadingSpinner';
import { useLoadGate } from '@/lib/use-load-gate';
import { useDisclosureGate } from '@/legal/useDisclosureGate';
import { DisclosureModal } from '@/legal/DisclosureModal';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useLoansStore } from '@/stores/loans-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useTickersStore } from '@/stores/tickers-store';
import { useInterviewAnswersStore } from '@/stores/interview-answers-store';
import { useRoadmap } from '@/domain/roadmap/context';
import { evaluate } from '@/domain/roadmap/evaluate';
import { NODES } from '@/domain/roadmap/nodes';
import { PageContainer } from '@/components/layout/PageContainer';
import { DisclosureBanner } from '@/components/roadmap/DisclosureBanner';
import { RoadmapAssumptions } from '@/components/roadmap/RoadmapAssumptions';
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
  const loadCategories = useCategoriesStore((s) => s.load);
  const loadOverrides = useRoadmapOverridesStore((s) => s.load);
  // Guided interview (D-GI14): six more input stores join the same latched
  // gate — vehicles/asset-snapshots/settings/holdings/tickers feed the
  // InterviewContext, interview-answers feeds the kernel walker. Interview
  // components never call .load() themselves (boot-loop gotcha).
  const loadVehicles = useVehiclesStore((s) => s.load);
  const loadAssetValueSnapshots = useAssetValueSnapshotsStore((s) => s.load);
  const loadSettings = useSettingsStore((s) => s.load);
  const loadHoldings = useHoldingsStore((s) => s.load);
  const loadTickers = useTickersStore((s) => s.load);
  const loadInterviewAnswers = useInterviewAnswersStore((s) => s.load);

  const reload = useCallback(() => {
    void loadHousehold();
    void loadPersons();
    void loadAccounts();
    void loadLoans();
    void loadContributions();
    void loadSnapshots();
    void loadTransactions();
    void loadCategories();
    void loadOverrides();
    void loadVehicles();
    void loadAssetValueSnapshots();
    void loadSettings();
    void loadHoldings();
    void loadTickers();
    void loadInterviewAnswers();
  }, [
    loadHousehold,
    loadPersons,
    loadAccounts,
    loadLoans,
    loadContributions,
    loadSnapshots,
    loadTransactions,
    loadCategories,
    loadOverrides,
    loadVehicles,
    loadAssetValueSnapshots,
    loadSettings,
    loadHoldings,
    loadTickers,
    loadInterviewAnswers,
  ]);

  // W10 M28: the engine (evaluate) renders authoritative-looking evidence
  // strings from whatever the 9 input stores currently hold. Deciding
  // before they settle = wrong "$0" evidence + wrongly-latched sections.
  // Gate the whole page (skeleton/error) until every input store settles.
  const loadGate = useLoadGate(
    [
      useHouseholdStore((s) => s.isLoading),
      usePersonsStore((s) => s.isLoading),
      useAccountsStore((s) => s.isLoading),
      useLoansStore((s) => s.isLoading),
      useContributionsStore((s) => s.isLoading),
      useSnapshotsStore((s) => s.isLoading),
      useTransactionsStore((s) => s.isLoading),
      useCategoriesStore((s) => s.isLoading),
      useRoadmapOverridesStore((s) => s.isLoading),
      useVehiclesStore((s) => s.isLoading),
      useAssetValueSnapshotsStore((s) => s.isLoading),
      useSettingsStore((s) => s.isLoading),
      useHoldingsStore((s) => s.isLoading),
      useTickersStore((s) => s.isLoading),
      useInterviewAnswersStore((s) => s.isLoading),
    ],
    [
      useHouseholdStore((s) => s.error),
      usePersonsStore((s) => s.error),
      useAccountsStore((s) => s.error),
      useLoansStore((s) => s.error),
      useContributionsStore((s) => s.error),
      useSnapshotsStore((s) => s.error),
      useTransactionsStore((s) => s.error),
      useCategoriesStore((s) => s.error),
      useRoadmapOverridesStore((s) => s.error),
      useVehiclesStore((s) => s.error),
      useAssetValueSnapshotsStore((s) => s.error),
      useSettingsStore((s) => s.error),
      useHoldingsStore((s) => s.error),
      useTickersStore((s) => s.error),
      useInterviewAnswersStore((s) => s.error),
    ],
    reload,
  );

  const ctx = useRoadmap();
  const household = useHouseholdStore((s) => s.household);
  const results = useMemo(
    () => (ctx ? evaluate(ctx) : new Map()),
    [ctx],
  );

  // W10 M28: nothing renders until every input store settles — no partial
  // engine output, no premature setup copy.
  if (!loadGate.settled) {
    return (
      <PageContainer className="space-y-4">
        <PageLoadingSpinner />
      </PageContainer>
    );
  }

  // If the household hasn't loaded yet, surface a setup prompt — the
  // disclosure gate would otherwise fire on a fresh user (because the
  // acceptances projection has no `roadmap` row yet) and trap a first-run
  // user behind a modal before the wizard ran. The wizard owns first
  // run, not the Roadmap.
  if (!household) {
    return (
      <PageContainer>
        <EmptyState icon={Compass} title="Set up your household to see your Roadmap.">
          <Button asChild size="sm" variant="outline">
            <Link to="/inputs/household">Set up household</Link>
          </Button>
        </EmptyState>
      </PageContainer>
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
      <PageContainer>
        <EmptyState icon={Compass} title="Set up your household to see your Roadmap.">
          <Button asChild size="sm" variant="outline">
            <Link to="/inputs/household">Set up household</Link>
          </Button>
        </EmptyState>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-4">
      {/* Wave-4 a11y: Roadmap was the only routed page without an h1. */}
      <h1 className="text-2xl font-semibold">Roadmap</h1>
      {/* W10 M28: the roadmap previously had NO store-error surface — a failed
          input load fell through to authoritative-looking engine output. */}
      <StoreErrorBanner errors={loadGate.errors} onRetry={loadGate.retry} />
      <DisclosureBanner />
      {/* Wave A C23: the person-view filter is hidden on this page (D3 — the
          advice engine's correctness depends on household aggregation); this
          page-level sentence declares the scope. Kept out of the disclosure
          registry: scope copy, not a disclosure edit. */}
      <p className="text-sm text-muted-foreground">
        The Roadmap evaluates your household as a whole — both incomes, all accounts.
      </p>
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
      {/* Wave C (DC1): answered write-once questions, reviewable + re-askable
          at the bottom of their one-place-per-thing home. */}
      <RoadmapAssumptions />
    </PageContainer>
  );
}
