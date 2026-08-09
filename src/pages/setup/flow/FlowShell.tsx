import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import PageLoadingSpinner from '@/components/layout/PageLoadingSpinner';
import { useLoadGate } from '@/lib/use-load-gate';
import { CITY_TAX_YEAR } from '@/lib/city-tax-year';
import {
  PART_LABELS, loadSetupProgress, saveSetupProgress, clearSetupProgress, stepMeta,
  type FlowPart, type SetupProgressV2, type StepStatus,
} from '@/lib/setup-progress';
import { markSetupDismissed } from '@/lib/setup-dismissal';
import { isTailorDone } from '@/lib/onboarding-state';
import {
  GATE_ENTITY_COUNT, effectiveStatus, nextInstance, partPosition, partStatus,
  prevInstance, resumeTarget, visibleInstances, type GateStepId,
} from '@/domain/setup-flow/engine';
import type { FlowCtx, StepInstance } from '@/domain/setup-flow/types';
import { STEP_COMPONENTS, SKIPPABLE } from './step-registry';
import { nameForRole } from '@/domain/setup-flow/steps/part2';
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
import { useHouseholdStore } from '@/stores/household-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';

interface Props {
  /** Renders the CW-3 toggle; dirty steps confirm first (CW-5, D-WF12). */
  onSwitchView: () => void;
}

const STATUS_BADGE: Partial<Record<StepStatus, string>> = {
  completed: '✓ done',
  skipped: '↩ skipped',
};

export default function FlowShell({ onSwitchView }: Props) {
  const navigate = useNavigate();

  // ── THE sanctioned hydration block (the ONLY .load()/loadYear call site in
  // the flow/domain modules — Task 12 receipt R5 greps exactly this) ──
  const loadAll = useCallback(() => {
    void usePersonsStore.getState().load();
    void useDependentsStore.getState().load();
    void useAccountsStore.getState().load();
    void useHoldingsStore.getState().load();
    void usePropertiesStore.getState().load();
    void useVehiclesStore.getState().load();
    void useHousingPaymentsStore.getState().load();
    void useVehicleLeasesStore.getState().load();
    void useEquityGrantsStore.getState().load();
    void useLoansStore.getState().load();
    void useSnapshotsStore.getState().load();
    void useAssetValueSnapshotsStore.getState().load();
    void useContributionsStore.getState().load();
    void useTransactionsStore.getState().load();
    void useGoalsStore.getState().load();
    void useHouseholdStore.getState().load();
    void useTaxRulesStore.getState().loadYear(CITY_TAX_YEAR);
  }, []);
  const gate = useLoadGate(
    [
      usePersonsStore((s) => s.isLoading), useDependentsStore((s) => s.isLoading),
      useAccountsStore((s) => s.isLoading), useHoldingsStore((s) => s.isLoading),
      usePropertiesStore((s) => s.isLoading), useVehiclesStore((s) => s.isLoading),
      useHousingPaymentsStore((s) => s.isLoading), useVehicleLeasesStore((s) => s.isLoading),
      useEquityGrantsStore((s) => s.isLoading), useLoansStore((s) => s.isLoading),
      useSnapshotsStore((s) => s.isLoading), useAssetValueSnapshotsStore((s) => s.isLoading),
      useContributionsStore((s) => s.isLoading), useTransactionsStore((s) => s.isLoading),
      useGoalsStore((s) => s.isLoading), useHouseholdStore((s) => s.isLoading),
      useTaxRulesStore((s) => s.isLoading),
    ],
    [
      usePersonsStore((s) => s.error), useDependentsStore((s) => s.error),
      useAccountsStore((s) => s.error), useHoldingsStore((s) => s.error),
      usePropertiesStore((s) => s.error), useVehiclesStore((s) => s.error),
      useHousingPaymentsStore((s) => s.error), useVehicleLeasesStore((s) => s.error),
      useEquityGrantsStore((s) => s.error), useLoansStore((s) => s.error),
      useSnapshotsStore((s) => s.error), useAssetValueSnapshotsStore((s) => s.error),
      useContributionsStore((s) => s.error), useTransactionsStore((s) => s.error),
      useGoalsStore((s) => s.error), useHouseholdStore((s) => s.error),
      useTaxRulesStore((s) => s.error),
    ],
    loadAll,
  );

  // ── shared progress + ctx ──
  const [progress, setProgress] = useState<SetupProgressV2>(() => loadSetupProgress());
  useEffect(() => {
    saveSetupProgress(progress);
  }, [progress]);
  // The ONE clock read (date purity — the store-answeredAt precedent).
  const todayIso = useRef(new Date().toISOString().slice(0, 10)).current;

  const household = useHouseholdStore((s) => s.household);
  const persons = usePersonsStore((s) => s.persons);
  const dependents = useDependentsStore((s) => s.dependents);
  const accounts = useAccountsStore((s) => s.accounts);
  const properties = usePropertiesStore((s) => s.properties);
  const housingPayments = useHousingPaymentsStore((s) => s.housingPayments);
  const vehicles = useVehiclesStore((s) => s.vehicles);
  const vehicleLeases = useVehicleLeasesStore((s) => s.vehicleLeases);
  const equityGrants = useEquityGrantsStore((s) => s.equityGrants);
  const loans = useLoansStore((s) => s.loans);
  const transactions = useTransactionsStore((s) => s.transactions);
  const goals = useGoalsStore((s) => s.goals);

  const ctx: FlowCtx = useMemo(() => ({
    household, persons, dependents, accounts, properties, housingPayments,
    vehicles, vehicleLeases, equityGrants, loans, transactions, goals,
    progress, todayIso,
  }), [
    household, persons, dependents, accounts, properties, housingPayments,
    vehicles, vehicleLeases, equityGrants, loans, transactions, goals,
    progress, todayIso,
  ]);

  // ── current instance (resume on settle; cursor mirrors it) ──
  const [current, setCurrent] = useState<StepInstance | null | 'finish'>(null);
  useEffect(() => {
    if (!gate.settled || current !== null) return;
    setCurrent(resumeTarget(ctx) ?? 'finish');
  }, [gate.settled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (current && current !== 'finish') {
      setProgress((p) => ({ ...p, cursor: { stepId: current.id, role: current.role } }));
    }
  }, [current]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [current]);

  const dirtyRef = useRef(false);
  const submitRef = useRef<(() => Promise<import('@/domain/setup-flow/types').StepSaveResult>) | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const confirmDiscardIfDirty = async (): Promise<boolean> => {
    if (!dirtyRef.current) return true;
    return confirm({
      title: 'Discard entries on this step?',
      description: "This step has entries that haven't been saved. Saved answers are not affected.",
      confirmLabel: 'Discard entries on this step',
      cancelLabel: 'Stay',
    });
  };

  const goTo = (inst: StepInstance | null) => {
    dirtyRef.current = false;
    submitRef.current = null;
    setCurrent(inst ?? 'finish');
  };

  const handleNext = async () => {
    if (current == null || current === 'finish') return;
    const result = (await submitRef.current?.()) ?? { ok: true as const };
    if (!result.ok) return; // validation errors render in the step
    // Compute the post-save progress deterministically, then advance over it
    // (branch flips — e.g. home "no" revealing rent — change visibility).
    let np = 'progressUpdate' in result && result.progressUpdate
      ? result.progressUpdate(progress)
      : progress;
    const meta = stepMeta(current.id);
    if (meta.gate) {
      // D-WF11 — the shell owns gate statuses.
      const count = GATE_ENTITY_COUNT[current.id as GateStepId](ctx);
      const gateAnswer = 'gateAnswer' in result ? result.gateAnswer : undefined;
      const status: StepStatus =
        gateAnswer === 'no' ? 'skipped' : count > 0 ? 'completed' : 'in_progress';
      np = { ...np, statuses: { ...np.statuses, [current.key]: status } };
    } else {
      np = { ...np, statuses: { ...np.statuses, [current.key]: 'completed' } };
    }
    setProgress(np);
    goTo(nextInstance(current, { ...ctx, progress: np }));
  };

  const handleSkip = () => {
    if (current == null || current === 'finish') return;
    // Writes NOTHING to entities — a skip is only a progress status.
    const np: SetupProgressV2 = {
      ...progress,
      statuses: { ...progress.statuses, [current.key]: 'skipped' },
    };
    setProgress(np);
    goTo(nextInstance(current, { ...ctx, progress: np }));
  };

  const handleBack = async () => {
    if (current == null || current === 'finish') return;
    if (!(await confirmDiscardIfDirty())) return;
    goTo(prevInstance(current, ctx));
  };

  const handleSwitchView = async () => {
    if (!(await confirmDiscardIfDirty())) return;
    onSwitchView();
  };

  const goToPart = async (part: FlowPart) => {
    const inPart = visibleInstances(ctx).filter((i) => i.part === part);
    if (inPart.length === 0) return;
    const target =
      inPart.find((i) => {
        const s = effectiveStatus(i, ctx);
        return s !== 'completed' && s !== 'skipped';
      }) ?? inPart[0];
    if (current !== 'finish' && current?.key === target.key) return;
    if (!(await confirmDiscardIfDirty())) return;
    goTo(target);
  };

  const handleFinish = () => {
    // Byte-identical behavior to SectionLayout.handleFinish (Task 10 extracts
    // the shared helper; this inline copy is replaced there).
    markSetupDismissed();
    clearSetupProgress();
    navigate(isTailorDone() ? '/' : '/welcome');
  };

  if (!gate.settled || current === null) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
        <PageLoadingSpinner />
      </div>
    );
  }

  const skippable = current !== 'finish' ? SKIPPABLE[current.id] : undefined;
  const skipConsequence =
    skippable && current !== 'finish'
      ? skippable.consequence.replace('{name}', nameForRole(ctx, current.role ?? 'you'))
      : undefined;
  const pos = current !== 'finish' ? partPosition(current, ctx) : null;
  const StepComponent = current !== 'finish' ? STEP_COMPONENTS[current.id] : null;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSwitchView}
          className="text-sm underline text-muted-foreground"
        >
          Switch to form view
        </button>
      </div>
      <nav aria-label="Setup progress" className="flex items-center gap-2 flex-wrap">
        {([1, 2, 3, 4, 5] as FlowPart[]).map((part) => {
          const status = partStatus(part, ctx);
          const isCurrent = current !== 'finish' && current.part === part;
          const badge = STATUS_BADGE[status];
          return (
            <button
              key={part}
              type="button"
              onClick={() => void goToPart(part)}
              className={`flex-1 text-xs py-2 px-2 rounded border text-left ${
                isCurrent
                  ? 'border-primary bg-primary/5 font-medium'
                  : status === 'completed'
                    ? 'border-success/40 text-success-foreground'
                    : status === 'skipped'
                      ? 'border-muted-foreground/30 text-muted-foreground'
                      : 'border-muted-foreground/20 text-muted-foreground'
              }`}
            >
              <div>{PART_LABELS[part]}</div>
              {badge && <div className="text-[10px] mt-0.5">{badge}</div>}
            </button>
          );
        })}
      </nav>

      {current === 'finish' ? (
        <div className="space-y-4">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-semibold outline-none"
          >
            That's everything.
          </h1>
          <p className="text-sm text-muted-foreground">
            Your answers live in the normal Inputs forms — everything here can be changed
            there later.
          </p>
          <Button type="button" onClick={handleFinish}>
            Finish setup
          </Button>
        </div>
      ) : (
        <>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-semibold outline-none"
          >
            {PART_LABELS[current.part]} — step {pos!.index} of {pos!.count}
          </h1>

          {StepComponent && (
            <StepComponent
              key={current.key}
              ctx={ctx}
              role={current.role}
              asked={(progress.statuses[current.key] ?? 'pending') !== 'pending'}
              onDirtyChange={(d) => {
                dirtyRef.current = d;
              }}
              submitRef={submitRef}
            />
          )}

          {skippable && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={handleSkip}
                className="text-sm underline text-muted-foreground"
              >
                {skippable.label}
              </button>
              <p className="text-xs text-muted-foreground">{skipConsequence}</p>
            </div>
          )}

          <div className="flex items-center justify-between pt-6 border-t">
            <Button
              type="button"
              variant="outline"
              disabled={prevInstance(current, ctx) == null}
              onClick={() => void handleBack()}
            >
              Back
            </Button>
            <Button type="button" onClick={() => void handleNext()}>
              Next
            </Button>
          </div>
        </>
      )}
      {confirmDialog}
    </div>
  );
}
