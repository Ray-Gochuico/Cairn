import { useCallback } from 'react';
import { create } from 'zustand';

/** UI naming (D-T11): "Today's $" = real, "Future $" = nominal. */
export type DollarBasis = 'today' | 'future';

/** The one v1 page instance (D-T7). W5.1 adds 'whatif' without API change. */
export const CALCULATORS_PAGE_ID = 'calculators';

const keyFor = (pageId: string) => `calc-basis:${pageId}`;

/** Corrupt/missing values fall back to the honest default (D-T3). */
function readInitial(pageId: string): DollarBasis {
  try {
    return sessionStorage.getItem(keyFor(pageId)) === 'future' ? 'future' : 'today';
  } catch {
    return 'today';
  }
}

/** Test seam only — mirrors next-dollar-store's readInitialForTests. */
export const readInitialForTests = readInitial;

interface DollarBasisState {
  /** Per-page basis; a page absent here reads sessionStorage lazily. */
  byPage: Record<string, DollarBasis>;
  setBasis: (pageId: string, b: DollarBasis) => void;
}

/**
 * W5 D-T2: THE single source of truth for the active display basis. Kept out
 * of useCalculatorState so flipping the view never sets isOverridden (the
 * property useChartDisplayMode deliberately had). sessionStorage per page
 * (D-T8): a cold boot always lands on Today's $. No other module may read the
 * storage key or hold basis state — tests/policy/dollar-basis-policy.test.ts
 * enforces it. The old calc-display-mode:* keys are simply never read again.
 */
export const useDollarBasisStore = create<DollarBasisState>((set) => ({
  byPage: {},
  setBasis: (pageId, b) => {
    try {
      sessionStorage.setItem(keyFor(pageId), b);
    } catch {
      // sessionStorage unavailable — in-memory state still drives the UI.
    }
    set((s) => ({ byPage: { ...s.byPage, [pageId]: b } }));
  },
}));

export function useDollarBasis(pageId: string): [DollarBasis, (b: DollarBasis) => void] {
  const stored = useDollarBasisStore((s) => s.byPage[pageId]);
  const setBasis = useDollarBasisStore((s) => s.setBasis);
  const set = useCallback((b: DollarBasis) => setBasis(pageId, b), [pageId, setBasis]);
  return [stored ?? readInitial(pageId), set];
}

/** Reset the in-memory slice between tests (the __reset idiom). */
export function __resetDollarBasisForTests(): void {
  useDollarBasisStore.setState({ byPage: {} });
}
