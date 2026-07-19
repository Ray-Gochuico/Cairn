import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScenarioBar } from './ScenarioBar';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useLoansStore } from '@/stores/loans-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useLoadGate } from '@/lib/use-load-gate';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { getCurrentTaxYear } from '@/lib/current-tax-year';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  applyCalculatorCardLayout,
  CALCULATOR_CARD_GROUPS,
  CALCULATOR_CARD_IDS,
  calculatorCardLabel,
} from '@/lib/calculator-card-layout';
import type { CardLayoutEntry } from '@/types/schema';
import { CALCULATOR_CARDS, type CalculatorCardRegistration } from './calculator-registry';
import { CalculatorShellProvider, type CalculatorShellApi } from './calculator-shell-context';

const STALE_BANNER_STORAGE_KEY = 'stale-tax-year-banner-dismissed';

/**
 * Build the next calculatorCardLayout from the current layout + a single
 * id→hidden mutation. Always returns a COMPLETE entry per CALCULATOR_CARD_IDS
 * so the persisted value is never partial (matches what the one-time import
 * writes). Pure.
 */
function withCardHidden(
  current: CardLayoutEntry[] | null,
  id: string,
  hidden: boolean,
): CardLayoutEntry[] {
  const hiddenById = new Map<string, boolean>();
  for (const entry of current ?? []) hiddenById.set(entry.id, entry.hidden);
  hiddenById.set(id, hidden);
  return CALCULATOR_CARD_IDS.map((cardId) => ({
    id: cardId,
    hidden: hiddenById.get(cardId) === true,
  }));
}

function CalculatorsSkeleton() {
  // Lightweight placeholder shown until settings resolves (cold deep-link to
  // /calculators; usually already warm via Sidebar's boot load). Mirrors the
  // app's lazy-route loading affordance — a non-jumpy neutral block, NOT the
  // 12 cards in a wrong (all-visible) state.
  return (
    <div className="space-y-4 min-w-0" data-testid="calculators-skeleton" aria-busy="true">
      <div className="h-8 w-48 rounded-md bg-muted motion-safe:animate-pulse" />
      <div className="h-4 w-full max-w-2xl rounded bg-muted motion-safe:animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 min-w-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-32 rounded-md border bg-muted/40 motion-safe:animate-pulse" />
        ))}
      </div>
    </div>
  );
}

interface SectionCustomizeProps {
  group: (typeof CALCULATOR_CARD_GROUPS)[number];
  cards: readonly CalculatorCardRegistration[];
  hiddenSet: Set<string>;
  isCardAvailable: (card: CalculatorCardRegistration) => boolean;
  setCardHidden: (id: string, hidden: boolean) => void;
}

function SectionCustomize({
  group,
  cards,
  hiddenSet,
  isCardAvailable,
  setCardHidden,
}: SectionCustomizeProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Esc closes and returns focus to the trigger. Same idiom as the retired
  // Manage-cards popover (and AssetValueChart's IncludedPicker): listener
  // only while open; preventDefault marks the event handled so outer Esc
  // handlers that respect defaultPrevented (the open card panel) defer.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Customize ${group.label}`}
        className="cursor-pointer text-xs text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
      >
        Customize ▾
      </button>
      {open && (
        <>
          {/* Backdrop — closes when clicked outside. */}
          <div className="fixed inset-0 z-10" aria-hidden="true" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label={`Customize ${group.label}`}
            className="absolute right-0 top-full z-20 mt-2 w-72 rounded-md border bg-background p-2 shadow-md"
          >
            <div className="mb-1 border-b px-2 pb-2 pt-1">
              <span className="text-xs font-medium text-muted-foreground">Show / hide cards</span>
            </div>
            <ul className="max-h-80 space-y-0.5 overflow-y-auto">
              {cards.map((card) => {
                const unavailable = !isCardAvailable(card);
                const visible = !hiddenSet.has(card.id);
                return (
                  <li
                    key={card.id}
                    className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-muted/40"
                  >
                    <span className="text-sm text-foreground">
                      {calculatorCardLabel(card.id)}
                      {unavailable && card.unavailableReason && (
                        <span className="block text-xs text-muted-foreground">
                          {card.unavailableReason}
                        </span>
                      )}
                    </span>
                    <Switch
                      checked={visible && !unavailable}
                      disabled={unavailable}
                      onCheckedChange={(next) => setCardHidden(card.id, !next)}
                      aria-label={calculatorCardLabel(card.id)}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export default function CalculatorsLayout() {
  const persons = usePersonsStore((s) => s.persons);

  // Cold-boot hydration. The cards READ persons/dependents/portfolio stores
  // but none of them LOAD them, and settings is only boot-loaded by Sidebar —
  // a cold deep-link to /calculators would otherwise see null settings (→
  // skeleton forever) and empty cards. Load them all once for the grid
  // (accounts feed the excluded-from-net-worth filter on the portfolio
  // prefills). W10 M63: household was the one store EVERY card reads that
  // nothing loaded — the FI card read a permanently-null household. Load it.
  const loadAll = useCallback(() => {
    void usePersonsStore.getState().load();
    void useDependentsStore.getState().load();
    void useSnapshotsStore.getState().load();
    void useAccountsStore.getState().load();
    void useContributionsStore.getState().load();
    void useLoansStore.getState().load();
    void useEquityGrantsStore.getState().load();
    void useSettingsStore.getState().load();
    void useHouseholdStore.getState().load();
  }, []);

  // W10 T1: keep the skeleton up until every hydrated store settles, so no
  // card flashes its "add your inputs" CTA over unloaded data.
  const gate = useLoadGate(
    [
      usePersonsStore((s) => s.isLoading),
      useDependentsStore((s) => s.isLoading),
      useSnapshotsStore((s) => s.isLoading),
      useAccountsStore((s) => s.isLoading),
      useContributionsStore((s) => s.isLoading),
      useLoansStore((s) => s.isLoading),
      useEquityGrantsStore((s) => s.isLoading),
      useSettingsStore((s) => s.isLoading),
      useHouseholdStore((s) => s.isLoading),
    ],
    [
      usePersonsStore((s) => s.error),
      useDependentsStore((s) => s.error),
      useSnapshotsStore((s) => s.error),
      useAccountsStore((s) => s.error),
      useContributionsStore((s) => s.error),
      useLoansStore((s) => s.error),
      useEquityGrantsStore((s) => s.error),
      useSettingsStore((s) => s.error),
      useHouseholdStore((s) => s.error),
    ],
    loadAll,
  );

  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);

  // Resolve the active tax year from the seeded set so we can warn when the
  // app's bundled rules predate the current calendar year.
  const taxItems = useTaxRulesStore((s) => s.items);
  const seededYears = useMemo(() => [...new Set(taxItems.map((r) => r.year))], [taxItems]);
  const { year: resolvedYear, isCurrent } = getCurrentTaxYear(seededYears);
  const showBanner = resolvedYear !== null && !isCurrent;

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STALE_BANNER_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(STALE_BANNER_STORAGE_KEY, 'true');
    } catch {
      // Ignore storage errors; in-memory dismiss still applies for this render.
    }
    setDismissed(true);
  };

  // Hidden state is sourced SOLELY from the DB-backed overlay (single source
  // of truth). No localStorage seed, no persistHiddenCards write path.
  const cardLayout = settings?.calculatorCardLayout ?? null;
  const hiddenSet = useMemo(
    () => new Set(applyCalculatorCardLayout(CALCULATOR_CARD_IDS, cardLayout)),
    [cardLayout],
  );

  // Availability gates (registry-declared). Only Overtime carries one today.
  const availabilityCtx = useMemo(() => ({ persons }), [persons]);
  const isCardAvailable = useCallback(
    (card: CalculatorCardRegistration) => !card.isAvailable || card.isAvailable(availabilityCtx),
    [availabilityCtx],
  );

  // The one-open accordion invariant (Wave 17). openId is THE source of truth;
  // cards consume it via CalculatorShellContext keyed by their cardId.
  const [openId, setOpenId] = useState<string | null>(null);

  // Toggle one card's visibility. Writes the COMPLETE layout to the DB; the
  // store refresh re-renders the grid. Wave-17 review fix: the Customize
  // popover STAYS OPEN across toggles (no close here).
  const setCardHidden = useCallback(
    (id: string, hidden: boolean) => {
      const next = withCardHidden(settings?.calculatorCardLayout ?? null, id, hidden);
      void updateSettings({ calculatorCardLayout: next }).catch(() => {});
      if (hidden) setOpenId((cur) => (cur === id ? null : cur));
    },
    [settings?.calculatorCardLayout, updateSettings],
  );

  const shellApi = useMemo<CalculatorShellApi>(
    () => ({
      openId,
      setOpenId,
      hideCard: (id: string) => setCardHidden(id, true),
    }),
    [openId, setCardHidden],
  );

  // D10: consume /calculators#<card-id> ONCE, after the settings gate settles
  // (before that we can't know hidden). Invalid, hidden, or unavailable ids
  // are ignored silently — the user's layout wins (Investments deep-link
  // posture). After consumption, openId mirrors into the fragment via
  // replaceState (never pushState — Back leaves the page, no history spam).
  const consumedInitialHash = useRef(false);
  useEffect(() => {
    if (consumedInitialHash.current || !gate.settled || settings === null) return;
    consumedInitialHash.current = true;
    const target = window.location.hash.slice(1);
    if (!target) return;
    const card = CALCULATOR_CARDS.find((c) => c.id === target);
    if (!card || hiddenSet.has(target) || !isCardAvailable(card)) return;
    setOpenId(target);
    // Smoke fix (checklist item 7): the card's own open-effect scrolls with
    // block:'nearest' on the commit where it opens — at cold load the content
    // above (bar + sections) is still settling, so that scroll can no-op
    // against a transient position and later layout pushes the card below
    // the fold. Re-run the scroll once the card's position has been STABLE
    // for two consecutive 50ms ticks (bounded at 10). setTimeout, not rAF:
    // rAF never fires in a hidden/background tab, which would strand a deep
    // link opened there. Interactive opens never take this path (the hash is
    // consumed ONCE), so clicking a visible trigger keeps its jank-free
    // 'nearest' behavior.
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let lastTop: number | null = null;
    let stableTicks = 0;
    let ticks = 0;
    const settleTick = () => {
      const el = document.getElementById(target);
      if (!el) return;
      const top = el.getBoundingClientRect?.().top ?? 0;
      stableTicks = lastTop !== null && Math.abs(top - lastTop) < 1 ? stableTicks + 1 : 0;
      lastTop = top;
      ticks += 1;
      if (stableTicks >= 2 || ticks >= 10) {
        // A hidden tab never animates a smooth scroll (frames are throttled
        // to zero) — jump instantly there, and under reduced motion.
        const instant = reduced || document.visibilityState !== 'visible';
        el.scrollIntoView?.({ block: 'nearest', behavior: instant ? 'auto' : 'smooth' });
        return;
      }
      window.setTimeout(settleTick, 50);
    };
    window.setTimeout(settleTick, 50);
  }, [gate.settled, settings, hiddenSet, isCardAvailable]);

  useEffect(() => {
    if (!consumedInitialHash.current) return;
    window.history.replaceState(
      null,
      '',
      openId ? `#${openId}` : window.location.pathname + window.location.search,
    );
  }, [openId]);

  // Render-gate: until settings resolves we cannot know which cards are hidden,
  // so show a skeleton rather than flashing all 12 in a wrong (all-visible)
  // state. settings is usually already warm via Sidebar's boot load.
  if (!gate.settled || settings === null) {
    return <CalculatorsSkeleton />;
  }

  return (
    <div className="space-y-4 min-w-0">
      <h1 className="text-2xl font-semibold">Calculators</h1>
      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      <p className="text-sm text-muted-foreground">
        All calculators run on your current Inputs data. Edit any field on a card to explore a
        scenario; use <span className="font-medium">Reset to my data</span> to restore it. For
        side-by-side scenario comparisons, see the{' '}
        <Link to="/what-if" className="text-primary hover:underline">What-If</Link> page.
      </p>
      {showBanner && !dismissed && (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-foreground"
        >
          <span>Using {resolvedYear} tax brackets — update the app for newer rates.</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            aria-label="Dismiss stale tax year banner"
            className="text-warning-foreground hover:bg-warning/10"
          >
            Dismiss
          </Button>
        </div>
      )}
      {/* Wave 16 (Basecamp spine): the shared scenario bar — mounts inside the
          settled gate, above the first section (Wave-17 placement contract). */}
      <ScenarioBar />
      <CalculatorShellProvider value={shellApi}>
        {CALCULATOR_CARD_GROUPS.map((group) => {
          const groupCards = CALCULATOR_CARDS.filter((c) => c.group === group.id);
          const visibleCards = groupCards.filter(
            (c) => !hiddenSet.has(c.id) && isCardAvailable(c),
          );
          return (
            <section key={group.id} aria-labelledby={`calc-section-${group.id}`} className="space-y-3 min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <h2
                  id={`calc-section-${group.id}`}
                  className="text-xs uppercase tracking-wider text-muted-foreground"
                >
                  {group.label}
                </h2>
                <SectionCustomize
                  group={group}
                  cards={groupCards}
                  hiddenSet={hiddenSet}
                  isCardAvailable={isCardAvailable}
                  setCardHidden={setCardHidden}
                />
              </div>
              {/* Wave-12 explicitly deferred this stacked double-hairline
                  divider ("Explicit non-goals") — Wave 17 cashes the chip:
                  two 1px border rules, 3px apart. */}
              <div aria-hidden="true" className="space-y-[3px]">
                <div className="border-t border-border" />
                <div className="border-t border-border" />
              </div>
              {visibleCards.length > 0 && (
                <div className="grid grid-cols-1 gap-4 min-w-0 md:grid-cols-2 xl:grid-cols-3">
                  {visibleCards.map(({ id, Component }) => (
                    <Component key={id} cardId={id} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </CalculatorShellProvider>
    </div>
  );
}
