import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FreshnessBadge } from '@/components/ui/freshness-badge';
import ChartToolbar from '@/components/whatif/ChartToolbar';
import FiCards from '@/components/whatif/FiCards';
import LeverBar from '@/components/whatif/LeverBar';
import MilestoneStrip from '@/components/whatif/MilestoneStrip';
import ProjectionChart from '@/components/whatif/ProjectionChart';
import ScenariosPanel from '@/components/whatif/ScenariosPanel';
import ManageScenariosModal from '@/components/whatif/ManageScenariosModal';
import { useRealState } from '@/components/whatif/useRealState';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useLoansStore } from '@/stores/loans-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import {
  detectMilestones,
  effectiveSwr,
  effectiveBaselineInflation,
  totalInvestments,
  type Milestones,
  type MonthlyState,
} from '@/lib/scenarios';
import { FiPillsPosition, ProjectionDetailLevel } from '@/types/enums';

export default function WhatIf() {
  const scenarios          = useScenariosStore((s) => s.scenarios);
  const load               = useScenariosStore((s) => s.load);
  const projectedScenarios = useScenariosStore((s) => s.projectedScenarios);
  const dollarMode         = useScenariosStore((s) => s.dollarMode);
  const horizonMonths      = useScenariosStore((s) => s.horizonMonths);

  const loadLoans          = useLoansStore((s) => s.load);
  const loadHoldings       = useHoldingsStore((s) => s.load);
  const loadAccounts       = useAccountsStore((s) => s.load);
  const loadSnapshots      = useSnapshotsStore((s) => s.load);
  const loadTransactions   = useTransactionsStore((s) => s.load);
  const loadPersons        = usePersonsStore((s) => s.load);
  const loadTaxYears       = useTaxRulesStore((s) => s.loadAvailableYears);

  const household          = useHouseholdStore((s) => s.household);
  const persons            = usePersonsStore((s) => s.persons);
  const accounts           = useAccountsStore((s) => s.accounts);

  // Household-default position for the FI / Coast FI pill row, with a
  // session-only inline override (chevron next to the row). Selecting a
  // primitive keeps unrelated Settings writes from re-rendering WhatIf.
  const defaultPillsPosition = useSettingsStore(
    (s) => s.settings?.defaultFiPillsPosition ?? FiPillsPosition.ABOVE,
  );
  const [pillsPositionOverride, setPillsPositionOverride] =
    useState<FiPillsPosition | null>(null);
  const pillsPosition = pillsPositionOverride ?? defaultPillsPosition;
  const togglePillsPosition = useCallback(() => {
    setPillsPositionOverride((prev) => {
      const current = prev ?? defaultPillsPosition;
      return current === FiPillsPosition.ABOVE
        ? FiPillsPosition.BELOW
        : FiPillsPosition.ABOVE;
    });
  }, [defaultPillsPosition]);

  // Projection detail level — household-default with session-only override.
  // Reading the primitive directly avoids re-render churn on unrelated
  // settings writes.
  const defaultDetailLevel = useSettingsStore(
    (s) => s.settings?.defaultProjectionDetailLevel ?? ProjectionDetailLevel.TAX_BUCKET,
  );
  const [detailLevel, setDetailLevel] =
    useState<ProjectionDetailLevel>(defaultDetailLevel);

  const [manageOpen, setManageOpen] = useState(false);

  // S-D's lever bar will expose a programmatic open-popover hook; wire
  // here once S-D lands. For now this is a no-op stub so the panel and
  // modal can pass an onEditLevers callback without breaking.
  const openLeversFor = useCallback((_scenarioId: number) => {}, []);

  // Subscribe to the full settings object for the inflation display path
  // (consumed below to resolve `displayInflation`). MUST be declared above
  // the `if (!real)` early return — otherwise the hook count differs
  // between the loading and loaded renders and React 19 trips
  // "Rendered more hooks than during the previous render".
  const settingsForDisplay = useSettingsStore((s) => s.settings) ?? null;

  useEffect(() => {
    load();
    loadLoans();
    loadHoldings();
    loadAccounts();
    loadSnapshots();
    loadTransactions();
    loadPersons();
    loadTaxYears();
  }, [load, loadLoans, loadHoldings, loadAccounts, loadSnapshots, loadTransactions, loadPersons, loadTaxYears]);

  const real = useRealState();

  const { projections, milestones } = useMemo(() => {
    if (!real) {
      return {
        projections: new Map<number, MonthlyState[]>(),
        milestones: new Map<number, Milestones>(),
      };
    }
    const projs = projectedScenarios(real);
    const ms = new Map<number, Milestones>();
    for (const [id, states] of projs) {
      const scenario = scenarios.find((s) => s.id === id) ?? null;
      const params = { withdrawalRate: effectiveSwr(scenario, household) };
      ms.set(id, detectMilestones(states, params));
    }
    return { projections: projs, milestones: ms };
  }, [real, scenarios, projectedScenarios, horizonMonths, household]);

  // Empty-state guard: if there are no projection rows (no visible
  // scenarios, no accounts with holdings, or persons.length === 0 so
  // payroll can't drive contributions), Recharts emits 32+ console
  // warnings about width(-1)/height(-1) and the chart paints an empty
  // $0 / $1 / $2 / $3 frame that looks broken on first open. Mirror
  // the empty-state card pattern from Investments.tsx so users see a
  // clear "set things up" CTA instead of a misleading zero chart.
  // (Wave-3 UX W3-3 + Wave-1 #9.)
  //
  // W7-UX MF-1: pre-fix this guard only checked `states.length > 0`.
  // That's true even when a seeded baseline scenario produces an array
  // of `MonthlyState` rows where every monetary field is 0 (no holdings,
  // no persons fully wired). Recharts then auto-domains the y-axis from
  // those sentinel zeros and paints $0/$1/$2/$3/$4 raw-dollar ticks,
  // which looks broken. Now we also require at least one state with a
  // non-zero balance signal (cash, netWorth, or any investment account)
  // so the chart only renders when there's something meaningful to plot.
  //
  // RM-1: This useMemo MUST live above the `if (!real)` early return
  // (and any other early returns) so React's hook-order invariant
  // holds across renders. Commit 31e9f09 fixed the same pattern for
  // settingsForDisplay; commit 1747c01 then reintroduced it when this
  // memo was added — Wave-7 review RM-1 caught the regression.
  const hasProjectionData = useMemo(() => {
    if (projections.size === 0) return false;
    for (const states of projections.values()) {
      if (states.length === 0) continue;
      for (const s of states) {
        if (s.cash > 0 || s.netWorth > 0 || totalInvestments(s) > 0) {
          return true;
        }
      }
    }
    return false;
  }, [projections]);

  // IMPORTANT: All useMemo / useState / useEffect declarations MUST be
  // above this early return. Hooks must always run in the same order
  // regardless of guard outcome. See commit 31e9f09 + Wave-7 RM-1.
  if (!real) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold mb-2">What-If</h1>
        <p className="text-muted-foreground">
          Set up your household and at least one account to start projecting scenarios.
        </p>
      </div>
    );
  }

  const fiCardsRow =
    household && persons.length > 0 ? (
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <FiCards
            scenarios={scenarios}
            projections={projections}
            household={household}
            persons={persons}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={togglePillsPosition}
          aria-label={
            pillsPosition === FiPillsPosition.ABOVE
              ? 'Move pills below charts'
              : 'Move pills above charts'
          }
          title={
            pillsPosition === FiPillsPosition.ABOVE
              ? 'Move pills below charts'
              : 'Move pills above charts'
          }
          className="h-6 w-6 mt-1 shrink-0"
        >
          <ArrowDownUp className="h-3 w-3" />
        </Button>
      </div>
    ) : null;

  // Resolve the "headline" inflation rate used for the nominal → real
  // display conversion. Task #15 (v1) chooses the simple baseline-rate
  // approach over computing per-year deflators — see
  // effectiveBaselineInflation() for the precedence chain. The active
  // scenario wins; otherwise we fall back to household / settings.
  // TODO(task15/v2): if the active scenario has per-year inflation
  // overrides, the display path could compute per-year deflators in
  // toReal() for a more accurate real-dollar view. Picked (a) baseline
  // for v1 per spec §6.
  const activeScenario =
    scenarios.find((s) => s.isActive) ?? scenarios.find((s) => s.isBaseline) ?? null;
  const displayInflation = effectiveBaselineInflation(
    activeScenario,
    household ?? null,
    settingsForDisplay,
  );

  const projectionChart = (
    <Card className="min-w-0" data-testid="whatif-projection-chart-wrap">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <CardTitle className="text-base">Net worth & total debt projection</CardTitle>
          <ScenariosPanel
            milestones={milestones}
            onOpenManage={() => setManageOpen(true)}
            onEditLevers={openLeversFor}
          />
        </div>
      </CardHeader>
      <CardContent>
        {hasProjectionData ? (
          <ProjectionChart
            scenarios={scenarios}
            projections={projections}
            milestones={milestones}
            dollarMode={dollarMode}
            inflation={displayInflation}
            startISO={real.startISO}
            detailLevel={detailLevel}
            accounts={accounts}
          />
        ) : (
          <div
            className="py-12 text-center text-muted-foreground"
            data-testid="whatif-projection-empty"
          >
            <p className="mb-3 text-sm">
              Add a person and at least one account to see your projection.
            </p>
            <div className="flex flex-wrap justify-center gap-2 text-sm">
              <Link to="/inputs/persons" className="underline text-foreground">
                Set up persons
              </Link>
              <span aria-hidden="true">·</span>
              <Link to="/inputs/accounts" className="underline text-foreground">
                Set up accounts
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-4 min-w-0" data-testid="whatif-page-wrap">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">What-If</h1>
          <FreshnessBadge size="sm" />
        </div>
        <ChartToolbar
          detailLevel={detailLevel}
          onDetailLevelChange={setDetailLevel}
        />
      </div>

      <LeverBar />

      {pillsPosition === FiPillsPosition.ABOVE ? (
        <>
          {fiCardsRow}
          {projectionChart}
        </>
      ) : (
        <>
          {projectionChart}
          {fiCardsRow}
        </>
      )}

      <MilestoneStrip scenarios={scenarios} milestones={milestones} />

      {/*
        Page-level projection footnote — surfaces three modeling
        omissions specific to long-horizon What-If projections.
        See W7-Legal R-LWI-4. Full disclosures live in
        Settings → Disclosures.
      */}
      <footer
        className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border/50"
        data-testid="whatif-projection-footnote"
      >
        <div className="font-medium text-foreground/80">
          What this projection doesn&rsquo;t model:
        </div>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="font-medium">Sequence-of-returns risk</span> —
            the engine compounds returns deterministically. Real-world
            retirement outcomes can differ significantly under poor
            early-retirement market years.
          </li>
          <li>
            <span className="font-medium">
              Medicare premiums + IRMAA surcharges
            </span>{' '}
            — retirement-year tax projections omit Medicare-related costs
            that can add $2k&ndash;$8k/yr per person at higher MAGI tiers.
          </li>
          <li>
            <span className="font-medium">
              Roth-conversion ladder timing
            </span>{' '}
            — the 5-year seasoning rule on converted amounts is not
            enforced; early withdrawals from converted balances may
            trigger penalties not reflected here.
          </li>
        </ul>
        <div className="pt-1">
          See Settings &rarr; Disclosures for full model assumptions.
        </div>
      </footer>

      {manageOpen && (
        <ManageScenariosModal
          milestones={milestones}
          onClose={() => setManageOpen(false)}
          onEditLevers={openLeversFor}
        />
      )}
    </div>
  );
}
