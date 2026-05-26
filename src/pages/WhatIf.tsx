import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { detectMilestones, effectiveSwr, type Milestones, type MonthlyState } from '@/lib/scenarios';
import { FiPillsPosition } from '@/types/enums';

export default function WhatIf() {
  const scenarios          = useScenariosStore((s) => s.scenarios);
  const load               = useScenariosStore((s) => s.load);
  const projectedScenarios = useScenariosStore((s) => s.projectedScenarios);
  const dollarMode         = useScenariosStore((s) => s.dollarMode);
  const inflation          = useScenariosStore((s) => s.inflation);
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

  const [manageOpen, setManageOpen] = useState(false);

  // S-D's lever bar will expose a programmatic open-popover hook; wire
  // here once S-D lands. For now this is a no-op stub so the panel and
  // modal can pass an onEditLevers callback without breaking.
  const openLeversFor = useCallback((_scenarioId: number) => {}, []);

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

  const projectionChart = (
    <Card className="min-w-0" data-testid="whatif-projection-chart-wrap">
      <CardHeader>
        <CardTitle className="text-base">Net worth & total debt projection</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <ProjectionChart
            scenarios={scenarios}
            projections={projections}
            milestones={milestones}
            dollarMode={dollarMode}
            inflation={inflation}
            startISO={real.startISO}
          />
          <ScenariosPanel
            milestones={milestones}
            onOpenManage={() => setManageOpen(true)}
            onEditLevers={openLeversFor}
          />
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-4 min-w-0" data-testid="whatif-page-wrap">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">What-If</h1>
        <ChartToolbar />
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
