import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings-store';
import { useTourStore } from '@/stores/tour-store';
import { applySidebarLayout } from '@/lib/sidebar-layout';
import { DEFAULT_SECTIONS } from '@/components/layout/Sidebar';
import { deriveTourSteps } from '@/lib/tour-steps';
import { markTourDone } from '@/lib/onboarding-state';

/** Header height the popover offsets below for top-of-sidebar targets. */
const HEADER_OFFSET = 44;
/** Viewport clamp margin for the popover. */
const VIEWPORT_MARGIN = 8;
/** Cutout padding around the measured sidebar link rect. */
const CUTOUT_PAD = 4;
const CUTOUT_RX = 6;
/** Popover width used for right-of-cutout placement + viewport clamping. */
const POPOVER_WIDTH = 320;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function isZeroOrOffscreen(r: Rect): boolean {
  if (r.width === 0 && r.height === 0) return true;
  return r.top < 0 || r.left < 0 || r.top > window.innerHeight || r.left > window.innerWidth;
}

export default function TourOverlay() {
  const active = useTourStore((s) => s.active);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const mode = useTourStore((s) => s.mode);
  const next = useTourStore((s) => s.next);
  const back = useTourStore((s) => s.back);
  const continueAll = useTourStore((s) => s.continueAll);
  const end = useTourStore((s) => s.end);

  // LIVE settings selector — sidebarLayout changes re-derive the step list.
  const settings = useSettingsStore((s) => s.settings);

  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [cutout, setCutout] = useState<Rect | null>(null);

  const sections = settings ? applySidebarLayout(DEFAULT_SECTIONS, settings.sidebarLayout) : [];
  const visibleTos = sections.flatMap((s) => s.items.map((i) => i.to));

  // Core steps for the forced walk; full visible set for counting/indexing.
  const coreSteps = settings ? deriveTourSteps(visibleTos, 'core') : [];
  const allSteps = settings ? deriveTourSteps(visibleTos, 'all') : [];
  // Non-core steps only — the actual tab list walked after "See the rest →".
  // stepIndex in 'all' mode is 0-based into this list.
  const nonCoreSteps = settings ? deriveTourSteps(visibleTos, 'noncore') : [];

  // Active step list for the current mode:
  //   'core' → coreSteps (the forced walk, ≤6).
  //   'all'  → nonCoreSteps (never re-shows a core tab). stepIndex is
  //            reset to 0 by continueAll() so it correctly indexes into this list.
  const steps = mode === 'core' ? coreSteps : nonCoreSteps;

  const total = steps.length;
  const safeIndex = total === 0 ? 0 : Math.min(stepIndex, total - 1);
  const step = steps[safeIndex] ?? null;

  // "n of N" counter:
  //   'core' → position in coreSteps (e.g. "3 of 6").
  //   'all'  → position in allSteps so the denominator is the full visible
  //            count and the user sees consistent "n of N" (e.g. "5 of 7" for
  //            /loans when 7 tabs are visible). Never shows "of 6" after the
  //            continuation, so the denominator naturally re-expands.
  const counterPosition =
    mode === 'core'
      ? safeIndex + 1
      : allSteps.findIndex((s) => s.to === step?.to) + 1;
  const counterTotal = mode === 'core' ? coreSteps.length : allSteps.length;

  // Gate for "See the rest →": only on the last core step when non-core tabs exist.
  const hasRemainder = nonCoreSteps.length > 0;
  const isLastCoreStep = mode === 'core' && safeIndex === coreSteps.length - 1;
  const isLastStepOverall = safeIndex === total - 1;
  // continueAll() resets stepIndex to 0 (index 0 in the nonCoreSteps list).
  const firstNonCoreIndex = 0;

  const finish = useCallback(() => {
    markTourDone();
    end();
  }, [end]);

  // Measure the current target sidebar link → cutout rect (jsdom: zeros →
  // centered fallback). rAF-debounced; scrollIntoView for offscreen targets.
  const rafRef = useRef<number | null>(null);
  const measure = useCallback(() => {
    if (!step) {
      setCutout(null);
      return;
    }
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-tour-id="${step.to}"]`);
      if (!el) {
        setCutout(null); // centered fallback
        return;
      }
      let box = el.getBoundingClientRect();
      if (isZeroOrOffscreen({ top: box.top, left: box.left, width: box.width, height: box.height })) {
        el.scrollIntoView({ block: 'nearest' });
        box = el.getBoundingClientRect();
      }
      if (box.width === 0 && box.height === 0) {
        setCutout(null); // still unmeasurable (jsdom) → centered fallback
        return;
      }
      setCutout({ top: box.top, left: box.left, width: box.width, height: box.height });
    });
  }, [step]);

  // Initial + per-step measure; observe the sidebar <aside> + its scroll.
  useLayoutEffect(() => {
    if (!active || !settings) return;
    measure();
    const aside = document.querySelector<HTMLElement>('aside');
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
    if (ro && aside) ro.observe(aside);
    const onScroll = () => measure();
    aside?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      ro?.disconnect();
      aside?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [active, settings, measure]);

  // Hand-rolled non-modal focus: capture on activate, restore on exit.
  useEffect(() => {
    if (!active || !settings) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, [active, settings]);

  // Focus the popover heading on each step change (aria-live announces body).
  useEffect(() => {
    if (active && settings && step) headingRef.current?.focus();
  }, [active, settings, step, safeIndex]);

  // Escape ends the tour.
  useEffect(() => {
    if (!active || !settings) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, settings, finish]);

  // Render gate (also the empty-derivation guard).
  if (!active || settings === null || step === null) return null;

  // Popover position: right of the cutout, clamped; centered fallback.
  const popoverStyle: React.CSSProperties = cutout
    ? {
        top: Math.min(
          Math.max(cutout.top, HEADER_OFFSET, VIEWPORT_MARGIN),
          Math.max(window.innerHeight - VIEWPORT_MARGIN, VIEWPORT_MARGIN),
        ),
        left: Math.min(
          cutout.left + cutout.width + CUTOUT_PAD * 2,
          Math.max(window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN, VIEWPORT_MARGIN),
        ),
      }
    : {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };

  return (
    <div className="fixed inset-0 z-50">
      {/* Dimmer + SVG-mask cutout (non-modal: bg-black/40). Popover follows
          in DOM so it stacks above without a separate z-index. The outer div
          carries data-tour-scrim and the bg-black/40 class; the inner SVG
          handles the mask so className is a plain string (not SVGAnimatedString). */}
      <div
        data-tour-scrim
        className="absolute inset-0 motion-safe:animate-in motion-safe:fade-in-0 bg-black/40"
        aria-hidden="true"
      >
        <svg className="h-full w-full">
          <defs>
            <mask id="tour-cutout">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {cutout && (
                <rect
                  x={cutout.left - CUTOUT_PAD}
                  y={cutout.top - CUTOUT_PAD}
                  width={cutout.width + CUTOUT_PAD * 2}
                  height={cutout.height + CUTOUT_PAD * 2}
                  rx={CUTOUT_RX}
                  fill="black"
                />
              )}
            </mask>
          </defs>
          {/* The dim fill, punched out over the active link. */}
          <rect x="0" y="0" width="100%" height="100%" fill="hsl(0 0% 0% / 0.4)" mask="url(#tour-cutout)" />
          {/* 1px primary hairline edge on the cutout (no feather). */}
          {cutout && (
            <rect
              x={cutout.left - CUTOUT_PAD}
              y={cutout.top - CUTOUT_PAD}
              width={cutout.width + CUTOUT_PAD * 2}
              height={cutout.height + CUTOUT_PAD * 2}
              rx={CUTOUT_RX}
              fill="none"
              stroke="hsl(var(--primary) / 0.6)"
              strokeWidth={1}
            />
          )}
        </svg>
      </div>

      {/* Anchored popover. role=dialog + aria-live for the non-modal a11y
          contract; transitions position with motion-reduce gating. */}
      <div
        role="dialog"
        aria-live="polite"
        aria-labelledby="tour-step-title"
        style={popoverStyle}
        className={cn(
          'absolute w-80 max-w-[calc(100vw-16px)] rounded-md border bg-popover p-4 text-popover-foreground shadow-md',
          'motion-safe:transition-all motion-safe:duration-200',
        )}
      >
        <h2
          id="tour-step-title"
          ref={headingRef}
          tabIndex={-1}
          className="text-base font-semibold leading-none tracking-tight outline-none"
        >
          {step.title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            {counterPosition} of {counterTotal}
          </span>
          <div className="flex items-center gap-2">
            {safeIndex > 0 && (
              <Button variant="ghost" size="sm" onClick={back}>
                Back
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={finish}>
              Skip tour
            </Button>
            {isLastCoreStep ? (
              <>
                {hasRemainder && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => continueAll(firstNonCoreIndex)}
                  >
                    See the rest &rarr;
                  </Button>
                )}
                <Button variant="default" size="sm" onClick={finish}>
                  Done
                </Button>
              </>
            ) : isLastStepOverall ? (
              <Button variant="default" size="sm" onClick={finish}>
                Done
              </Button>
            ) : (
              <Button variant="default" size="sm" onClick={next}>
                Next &rarr;
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
