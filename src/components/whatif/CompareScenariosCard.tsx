// empty-state-policy: allow — the gate is PAGE-owned by design (W3 constraint
// 8 / the boot-loop gotcha): WhatIf.tsx renders this card only after its
// latched useLoadGate settles, and a descendant store read here would be the
// re-load loop that gotcha forbids. This component takes resolved props only.
/**
 * W3 — Compare scenarios (D-W3-1/2/3). Pure render over the plan-review
 * model — all copy is built in lib (the FrameworkCard contract). The ONLY
 * literals here are headings, picker chrome, and aria labels (CR-1..CR-8b),
 * each pinned by test. The picker is a lens: session state via the page,
 * never writes visible/isActive, nothing persisted.
 * No aria-live region (owner constraint 3 precedent — recompute follows an
 * explicit picker change; no announcement).
 * NO line-clamp / truncate anywhere: an ellipsized honesty clause is a
 * correctness bug (smoke fix 656d1bae).
 */
import { Fragment, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/EmptyState';
import { SaveCurrentDialog } from './SaveCurrentDialog';
import {
  buildPlanReview, SECOND_SCENARIO_PROMPT, SEND_POINTER,
  type PlanReviewModel, type ResolvedComparePair, type ReviewLine,
} from '@/lib/whatif/plan-review';
import {
  buildLeverDiff, computeAssumptionParity, type EngineDefaults,
} from '@/lib/whatif/lever-diff';
import type { Milestones, MonthlyState } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';
import type { Household } from '@/types/schema';
import type { DollarMode } from '@/stores/scenarios-store';

interface CompareScenariosCardProps {
  scenarios: Scenario[];
  projections: Map<number, MonthlyState[]>;
  milestones: Map<number, Milestones>;
  household: Household | null;
  engineDefaults: EngineDefaults;
  dollarMode: DollarMode;
  horizonMonths: number;
  displayInflation: number;
  deflatorSourceLabel: string;
  loanNames: Record<number, string>;
  pair: ResolvedComparePair;
  onSelectA: (id: number) => void;
  onSelectB: (id: number) => void;
}

function ReviewLineText({ line }: { line: ReviewLine }) {
  return (
    <p className="text-sm leading-relaxed">
      {line.parts.map((p, idx) =>
        p.emphasis
          ? <span key={idx} className="font-medium tabular-nums">{p.text}</span>
          : <Fragment key={idx}>{p.text}</Fragment>,
      )}
    </p>
  );
}

const SELECT_CLS = 'h-7 rounded-md border border-input bg-background px-1 text-sm';

export function CompareScenariosCard({
  scenarios, projections, milestones, household, engineDefaults,
  dollarMode, horizonMonths, displayInflation, deflatorSourceLabel,
  loanNames, pair, onSelectA, onSelectB,
}: CompareScenariosCardProps) {
  const [saveOpen, setSaveOpen] = useState(false);
  const a = pair.a;
  const b = pair.b;

  const model: PlanReviewModel | null = useMemo(() => {
    if (scenarios.length < 2 || a?.id == null || b?.id == null) return null;
    const sideOf = (s: Scenario) => ({
      name: s.name,
      payload: s.leverPayload,
      states: projections.get(s.id as number) ?? [],
      milestones: milestones.get(s.id as number) ?? ({} as Milestones),
    });
    return buildPlanReview({
      a: sideOf(a),
      b: sideOf(b),
      dollarMode,
      horizonMonths,
      deflator: { rate: displayInflation, sourceLabel: deflatorSourceLabel },
      parity: computeAssumptionParity(a.leverPayload, b.leverPayload, household, engineDefaults),
      leverDiff: buildLeverDiff(a.leverPayload, b.leverPayload, { loanNames }),
    });
  }, [scenarios.length, a, b, projections, milestones, dollarMode, horizonMonths, displayInflation, deflatorSourceLabel, household, engineDefaults, loanNames]);

  if (scenarios.length === 0) return null;

  if (scenarios.length === 1) {
    const userScenarioCount = scenarios.filter((s) => !s.isBaseline).length;
    return (
      <Card data-testid="whatif-compare-card">
        <CardContent className="pt-6">
          <EmptyState bare title={SECOND_SCENARIO_PROMPT}>
            <div className="flex flex-col items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setSaveOpen(true)}>
                + Save current
              </Button>
              <p className="text-xs text-muted-foreground">{SEND_POINTER}</p>
            </div>
          </EmptyState>
          {saveOpen && (
            <SaveCurrentDialog
              defaultName={`Scenario ${userScenarioCount + 1}`}
              onClose={() => setSaveOpen(false)}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  if (!model) return null;

  const dot = (s: Scenario) => (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-2 rounded-full shrink-0"
      style={{ backgroundColor: s.color }}
    />
  );
  const options = (exclude: number | null | undefined) =>
    scenarios
      .filter((s) => s.id != null && s.id !== exclude)
      .map((s) => <option key={s.id} value={s.id as number}>{s.name}</option>);

  return (
    <Card className="min-w-0" data-testid="whatif-compare-card">
      <section aria-labelledby="compare-scenarios-heading">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle id="compare-scenarios-heading" className="text-base">
              Compare scenarios
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-sm min-w-0">
              {a != null && dot(a)}
              <label className="flex items-center gap-1 min-w-0">
                <span className="text-muted-foreground">A</span>
                <select
                  aria-label="Compare scenario A"
                  className={SELECT_CLS}
                  value={a?.id ?? ''}
                  onChange={(e) => onSelectA(Number(e.target.value))}
                >
                  {options(null)}
                </select>
              </label>
              <span className="text-muted-foreground">vs</span>
              {b != null && dot(b)}
              <label className="flex items-center gap-1 min-w-0">
                <span className="text-muted-foreground">B</span>
                <select
                  aria-label="Compare scenario B"
                  className={SELECT_CLS}
                  value={b?.id ?? ''}
                  onChange={(e) => onSelectB(Number(e.target.value))}
                >
                  {options(a?.id ?? null)}
                </select>
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-border/50 p-3 space-y-1" data-testid="compare-yardstick">
            <div className="text-xs font-medium text-foreground/80">Same yardstick</div>
            {model.yardstick.map((l, idx) => <ReviewLineText key={idx} line={l} />)}
          </div>
          <div>
            <div className="text-xs font-medium text-foreground/80">Bottom line</div>
            <ReviewLineText line={model.bottomLine} />
          </div>
          {model.tradeoffs.length > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground/80">Tradeoffs</div>
              <ul className="list-disc pl-5 space-y-1">
                {model.tradeoffs.map((l, idx) => <li key={idx}><ReviewLineText line={l} /></li>)}
              </ul>
            </div>
          )}
          {model.mainDifference.length > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground/80">Main difference</div>
              <ul className="space-y-1">
                {model.mainDifference.map((l, idx) => <li key={idx}><ReviewLineText line={l} /></li>)}
              </ul>
            </div>
          )}
          <div className="text-xs text-muted-foreground border-t border-border/50 pt-2">
            {model.footer}
          </div>
        </CardContent>
      </section>
    </Card>
  );
}

export default CompareScenariosCard;
