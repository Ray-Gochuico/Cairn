import { create } from 'zustand';

export type TourMode = 'core' | 'all';

interface TourState {
  /** Whether the spotlight overlay is currently shown. */
  active: boolean;
  /** Index into the *derived* active-step list (see deriveTourSteps). */
  stepIndex: number;
  /**
   * 'core' = the forced curated walk (core ∩ visible, ≤6).
   * 'all'  = the optional "see the rest" continuation through the full
   *          visible tab set. The overlay re-derives its step list and
   *          re-expands the "n of N" denominator when mode flips.
   */
  mode: TourMode;
  /**
   * Begin the tour. IDEMPOTENT: a no-op when already active so a
   * StrictMode double-invoke or a re-entrant controller call never
   * rewinds an in-progress tour back to step 0.
   */
  start: () => void;
  /** Advance to the next step. The overlay bounds the upper end. */
  next: () => void;
  /** Step back; clamped so stepIndex never goes negative. */
  back: () => void;
  /**
   * Enter "see the rest" — switch to 'all' and jump to `startIndex` (the
   * index of the first non-core step in the 'all' step list). Callers must
   * pass the correct index so the overlay never skips or re-shows a core tab.
   */
  continueAll: (startIndex: number) => void;
  /** Finish/skip: deactivate and reset for a clean future replay. */
  end: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  active: false,
  stepIndex: 0,
  mode: 'core',

  start: () => {
    if (get().active) return; // idempotent — preserve in-progress state
    set({ active: true, stepIndex: 0, mode: 'core' });
  },
  next: () => set((s) => ({ stepIndex: s.stepIndex + 1 })),
  back: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
  continueAll: (startIndex: number) => set({ mode: 'all', stepIndex: startIndex }),
  end: () => set({ active: false, stepIndex: 0, mode: 'core' }),
}));
