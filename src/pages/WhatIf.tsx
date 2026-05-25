import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ChartToolbar from '@/components/whatif/ChartToolbar';
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
import { useTransactionsStore } from '@/stores/transactions-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { detectMilestones, type Milestones, type MonthlyState } from '@/lib/scenarios';

const FIRE_PARAMS = { withdrawalRate: 0.04 };

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
  const loadTransactions   = useTransactionsStore((s) => s.load);
  const loadPersons        = usePersonsStore((s) => s.load);
  const loadTaxYears       = useTaxRulesStore((s) => s.loadAvailableYears);

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
    loadTransactions();
    loadPersons();
    loadTaxYears();
  }, [load, loadLoans, loadHoldings, loadAccounts, loadTransactions, loadPersons, loadTaxYears]);

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
      ms.set(id, detectMilestones(states, FIRE_PARAMS));
    }
    return { projections: projs, milestones: ms };
  }, [real, scenarios, projectedScenarios, horizonMonths]);

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

  return (
    <div className="p-6 space-y-4 min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">What-If</h1>
        <ChartToolbar />
      </div>

      <LeverBar />

      <Card className="min-w-0">
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
