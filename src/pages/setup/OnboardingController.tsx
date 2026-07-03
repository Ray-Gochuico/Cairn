import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  computeTailoring,
  hasAnyHideRecommendation,
  type TailoringResult,
} from '@/lib/onboarding-tailoring';
import { TailorStep } from '@/components/onboarding/TailorStep';
import { useTourStore } from '@/stores/tour-store';
import { markTailorDone, markTourDone } from '@/lib/onboarding-state';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useLoansStore } from '@/stores/loans-store';

/**
 * Post-setup onboarding controller (route element for `/welcome`, a sibling of
 * `/setup` outside PageShell). This is the SINGLE call-site of
 * `computeTailoring` (the Tailor step consumes the result, never recomputes).
 *
 * Flow: "You're set up" → (Tailor, only if there's something to hide) → Tour.
 *
 * Pending UX (no spinner at the celebratory beat): the data-independent
 * "You're set up" card renders IMMEDIATELY; the "Step 1 of N" denominator is a
 * quiet placeholder ("Step 1") until the 7 entity stores resolve, then fills in
 * "of N". Continue is enabled at once; if clicked before the stores resolve it
 * awaits the mount-time allSettled promise (macrotask-friendly — never a
 * microtask poll) before deciding Tailor-vs-skip.
 *
 * Gating contract (also applied inside Tailor, §B1): we do not decide until
 * `ready` = all 7 stores resolved at least once && none loading; ANY store with
 * `error !== null` forces that group visible — a load failure must never hide a
 * data-bearing tab/card, and an errored read must never silently collapse N to
 * 2 (the controller treats an errored group as "there is a surface to review",
 * so we land on Tailor where the retry lives, never skip past it).
 */

type Phase = 'intro' | 'tailor';

/** Live isLoading probe across the 7 entity stores (getState — no subscription). */
function someLoadingNow(): boolean {
  return (
    usePersonsStore.getState().isLoading ||
    useAccountsStore.getState().isLoading ||
    useHoldingsStore.getState().isLoading ||
    usePropertiesStore.getState().isLoading ||
    useVehiclesStore.getState().isLoading ||
    useEquityGrantsStore.getState().isLoading ||
    useLoansStore.getState().isLoading
  );
}

export default function OnboardingController() {
  const navigate = useNavigate();
  const { start: tourStart } = useTourStore();

  // Subscribe to the load/error posture of each of the 7 entity stores.
  // Subscribe to scalar fields individually to avoid creating new objects on
  // every render (which would cause React's getSnapshot-caching warning and
  // an infinite update loop).
  const personsLoading = usePersonsStore((s) => s.isLoading);
  const personsError = usePersonsStore((s) => s.error);
  const accountsLoading = useAccountsStore((s) => s.isLoading);
  const accountsError = useAccountsStore((s) => s.error);
  const holdingsLoading = useHoldingsStore((s) => s.isLoading);
  const holdingsError = useHoldingsStore((s) => s.error);
  const propertiesLoading = usePropertiesStore((s) => s.isLoading);
  const propertiesError = usePropertiesStore((s) => s.error);
  const vehiclesLoading = useVehiclesStore((s) => s.isLoading);
  const vehiclesError = useVehiclesStore((s) => s.error);
  const equityGrantsLoading = useEquityGrantsStore((s) => s.isLoading);
  const equityGrantsError = useEquityGrantsStore((s) => s.error);
  const loansLoading = useLoansStore((s) => s.isLoading);
  const loansError = useLoansStore((s) => s.error);

  // True once our own mount-time load() of all 7 stores has settled at least
  // once (independent of the live isLoading flags, which a later CRUD load()
  // could re-toggle — but this route is first-run and short-lived).
  const [loadsSettled, setLoadsSettled] = useState(false);
  const [phase, setPhase] = useState<Phase>('intro');
  // The decision, materialized once `ready`: { result, hasRecs, N }.
  const decisionRef = useRef<{ result: TailoringResult; hasRecs: boolean; n: number } | null>(null);
  // The mount effect's Promise.allSettled, kept so awaitDecision can await
  // the SAME settlement the effect observes (see the comment there).
  const settleRef = useRef<Promise<void> | null>(null);
  const [resolvedN, setResolvedN] = useState<number | null>(null);

  // Kick all 7 loads once on mount; mark settled when every one resolves or
  // rejects (rejection sets the store's `error`, which the gate honors).
  useEffect(() => {
    let cancelled = false;
    settleRef.current = Promise.allSettled([
      usePersonsStore.getState().load(),
      useAccountsStore.getState().load(),
      useHoldingsStore.getState().load(),
      usePropertiesStore.getState().load(),
      useVehiclesStore.getState().load(),
      useEquityGrantsStore.getState().load(),
      useLoansStore.getState().load(),
    ]).then(() => {
      if (!cancelled) setLoadsSettled(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const anyLoading =
    personsLoading || accountsLoading || holdingsLoading ||
    propertiesLoading || vehiclesLoading || equityGrantsLoading || loansLoading;
  const ready = loadsSettled && !anyLoading;

  // Suppress unused-variable lint for error fields (consumed via getState() in computeDecision).
  void personsError; void accountsError; void holdingsError;
  void propertiesError; void vehiclesError; void equityGrantsError; void loansError;

  // Compute the decision exactly once, the first time we're ready. We read the
  // full store contents here (not the snapshots) for the engine input.
  const computeDecision = useCallback((): { result: TailoringResult; hasRecs: boolean; n: number } => {
    if (decisionRef.current) return decisionRef.current;

    const result = computeTailoring({
      persons: usePersonsStore.getState().persons,
      accounts: useAccountsStore.getState().accounts,
      holdings: useHoldingsStore.getState().holdings,
      properties: usePropertiesStore.getState().properties,
      vehicles: useVehiclesStore.getState().vehicles,
      equityGrants: useEquityGrantsStore.getState().equityGrants,
      loans: useLoansStore.getState().loans,
      today: new Date(),
    });

    // Errored-store-force-visible, applied BEFORE deciding. An errored read must
    // (a) never hide its group and (b) never let N collapse to 2. We treat any
    // errored store as a forced "surface to review" so we always route through
    // Tailor (where the per-group retry lives) on an errored read.
    const anyErrored = [
      usePersonsStore.getState().error,
      useAccountsStore.getState().error,
      useHoldingsStore.getState().error,
      usePropertiesStore.getState().error,
      useVehiclesStore.getState().error,
      useEquityGrantsStore.getState().error,
      useLoansStore.getState().error,
    ].some((e) => e !== null);

    const hasRecs = anyErrored || hasAnyHideRecommendation(result);
    const n = hasRecs ? 3 : 2;
    decisionRef.current = { result, hasRecs, n };
    return decisionRef.current;
  }, []);

  // Resolve N lazily for the indicator the moment we become ready (so "of N"
  // fills in without a click). Runs once: decisionRef latches it.
  useEffect(() => {
    if (ready && resolvedN === null) {
      setResolvedN(computeDecision().n);
    }
  }, [ready, resolvedN, computeDecision]);

  /**
   * Wait until the mount-time loads settle, then resolve the decision. Lets
   * Continue be clicked before the stores resolve (the warm path latches via
   * decisionRef, so this is usually synchronous).
   *
   * WHY await-a-promise, not poll: the previous implementation polled with a
   * self-requeuing queueMicrotask loop. Microtasks starve the event loop, so
   * the Tauri IPC responses and React renders that flip the polled flags are
   * macrotasks that could NEVER arrive — a permanent hang whenever Continue
   * was clicked before the 7 loads settled. Awaiting the allSettled chain
   * (and yielding via setTimeout between residual isLoading checks) keeps
   * the event loop turning.
   */
  const awaitDecision = useCallback(async () => {
    if (decisionRef.current) return decisionRef.current;
    await (settleRef.current ?? Promise.resolve());
    // Wait out any residual isLoading (e.g. a re-load kicked off elsewhere)
    // on a macrotask cadence — same wait contract as before, without the
    // starvation.
    while (someLoadingNow()) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return computeDecision();
  }, [computeDecision]);

  const goToTour = useCallback(() => {
    tourStart();
    navigate('/');
  }, [tourStart, navigate]);

  const handleContinue = useCallback(async () => {
    const { hasRecs } = await awaitDecision();
    if (hasRecs) {
      setPhase('tailor');
    } else {
      goToTour();
    }
  }, [awaitDecision, goToTour]);

  const handleSkip = useCallback(() => {
    // "Skip setup help": short-circuit the whole flow.
    markTailorDone();
    markTourDone();
    navigate('/');
  }, [navigate]);

  // Tailor's own onDone/onSkip both lead into the tour (completion markers are
  // written by the controller via markTailorDone/markTourDone, not TailorStep;
  // the controller just advances the sequence).
  const handleTailorDone = useCallback(() => goToTour(), [goToTour]);
  const handleTailorSkip = useCallback(() => goToTour(), [goToTour]);

  if (phase === 'tailor' && decisionRef.current) {
    return (
      <TailorStep
        result={decisionRef.current.result}
        totalSteps={decisionRef.current.n}
        onDone={handleTailorDone}
        onSkip={handleTailorSkip}
      />
    );
  }

  // "You're set up" — renders immediately, data-independent. N is a quiet
  // placeholder ("Step 1") until resolved, then "Step 1 of N".
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
      <Card className="max-w-md w-full">
        <CardHeader className="space-y-1.5">
          <p
            data-testid="onboarding-step-indicator"
            className="text-sm text-muted-foreground"
          >
            {resolvedN === null ? 'Step 1' : `Step 1 of ${resolvedN}`}
          </p>
          <CardTitle>
            <h1 className="text-2xl font-semibold">You&apos;re set up</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Nice work — your data is in. Next we&apos;ll tailor which tools you
            see to what you entered, then take a quick tour of the essentials.
          </p>
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={handleSkip}>
              Skip setup help
            </Button>
            <Button type="button" onClick={() => void handleContinue()}>
              Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
