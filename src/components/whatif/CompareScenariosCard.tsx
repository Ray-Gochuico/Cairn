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
  buildLeverDiff, computeAssumptionParity, type EngineContext,
} from '@/lib/whatif/lever-diff';
import type { MonthlyState } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';
import type { Household } from '@/types/schema';
import type { DollarBasis } from '@/lib/calculators/dollar-basis';
import type { BasedMilestones, RegisteredFigure } from '@/lib/calculators/basis-view';

interface CompareScenariosCardProps {
  scenarios: Scenario[];
  projections: Map<number, MonthlyState[]>;
  /** W5.1: ALREADY based + branded by the page's WhatIfBasisView (D-T5). */
  displayMilestones: Map<number, BasedMilestones>;
  household: Household | null;
  engineContext: EngineContext;
  /** W5.1 (D-T11): the page basis; every side's brand must match it. */
  basis: DollarBasis;
  horizonMonths: number;
  displayInflation: number;
  deflatorSourceLabel: string;
  loanNames: Record<number, string>;
  pair: ResolvedComparePair;
  onSelectA: (id: number) => void;
  onSelectB: (id: number) => void;
}

function ReviewLineText({ line, testId }: { line: ReviewLine; testId: string }) {
  return (
    <p className="text-sm leading-relaxed" data-testid={testId}>
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
  scenarios, projections, displayMilestones, household, engineContext,
  basis, horizonMonths, displayInflation, deflatorSourceLabel,
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
      // A side without a milestone entry is still BRANDED — the lib's guard
      // needs the basis, never a naked {}.
      milestones: displayMilestones.get(s.id as number) ?? ({ basis } as BasedMilestones),
    });
    return buildPlanReview({
      a: sideOf(a),
      b: sideOf(b),
      basis,
      horizonMonths,
      deflator: { rate: displayInflation, sourceLabel: deflatorSourceLabel },
      parity: computeAssumptionParity(a.leverPayload, b.leverPayload, household, engineContext),
      // C1 (D-C1-5): the diff reads income.perPerson at the ENGINE's width —
      // one plan per person on file — from the same context the parity uses.
      leverDiff: buildLeverDiff(a.leverPayload, b.leverPayload, { loanNames, personCount: engineContext.persons.length }),
    });
  }, [scenarios.length, a, b, projections, displayMilestones, basis, horizonMonths, displayInflation, deflatorSourceLabel, household, engineContext, loanNames]);

  if (scenarios.length === 0) return null;

  if (scenarios.length === 1) {
    const userScenarioCount = scenarios.filter((s) => !s.isBaseline).length;
    return (
      <Card data-testid="whatif-compare-card">
        {/* Smoke M4 (2026-09-02): the CR-1 heading is the aria-labelledby
            target, so it stays in the prompt state too — without it the region
            had no accessible name. The heading NAMES the card; the prompt
            sentence stays the EmptyState's bare title. */}
        <section aria-labelledby="compare-scenarios-heading">
          <CardHeader className="pb-2">
            <CardTitle id="compare-scenarios-heading" className="text-base">
              Compare scenarios
            </CardTitle>
          </CardHeader>
          <CardContent>
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
        </section>
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
            {model.yardstick.map((l, idx) => <ReviewLineText key={idx} line={l} testId="compare-yardstick-line" />)}
          </div>
          <div>
            <div className="text-xs font-medium text-foreground/80">Bottom line</div>
            <ReviewLineText line={model.bottomLine} testId="compare-bottom-line" />
          </div>
          {model.tradeoffs.length > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground/80">Tradeoffs</div>
              <ul className="list-disc pl-5 space-y-1">
                {model.tradeoffs.map((l, idx) => <li key={idx}><ReviewLineText line={l} testId="compare-tradeoff" /></li>)}
              </ul>
            </div>
          )}
          {model.mainDifference.length > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground/80">Main difference</div>
              <ul className="space-y-1">
                {model.mainDifference.map((l, idx) => <li key={idx}><ReviewLineText line={l} testId="compare-main-difference" /></li>)}
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

/** W5.1 test-only registration (frozen W5 contract). The bottom line's class
 *  depends on which ladder rung fires, so the registries are RUNG-SPECIFIC
 *  (P6); yardstick lines are basis STATEMENTS (Y2/Y3 flip as prose) and stay
 *  unregistered — the $-completeness scan still guards them. */
export const COMPARE_BASIS_FIGURES_BL3: RegisteredFigure[] = [
  { testId: 'compare-bottom-line', cls: 'convertible' },   // inventory #5 (BL3)
  { testId: 'compare-main-difference', cls: 'invariant' }, // #8
];
export const COMPARE_BASIS_FIGURES_BL1_TRNW: RegisteredFigure[] = [
  { testId: 'compare-bottom-line', cls: 'invariant' },     // BL1 — dates only
  { testId: 'compare-tradeoff', cls: 'convertible' },      // #5 (TR-NW)
  { testId: 'compare-main-difference', cls: 'invariant' }, // #8 (lever $)
];
export const COMPARE_BASIS_FIGURES_BL6: RegisteredFigure[] = [
  { testId: 'compare-bottom-line', cls: 'convertible' },   // #6 (BL6 floor)
  { testId: 'compare-main-difference', cls: 'invariant' },
];

export default CompareScenariosCard;
