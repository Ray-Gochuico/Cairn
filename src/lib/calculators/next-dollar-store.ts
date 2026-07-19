import { create } from 'zustand';

const KEY = 'calc-shared:next-dollar';

function readInitial(): number | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/** Test seam only — production reads happen once at store creation. */
export const readInitialForTests = readInitial;

interface NextDollarState {
  /** $/mo the household wants to put to work. null = not set. */
  amount: number | null;
  setAmount: (v: number | null) => void;
}

/**
 * D5: the section-level "next dollar" figure. A zustand store (not bare
 * sessionStorage) because THREE components subscribe live — the section
 * header input, Debt payoff, and the Allocator. Session-scoped like every
 * other calculator scenario value. It feeds the two tools as their
 * useCalculatorState DEFAULT — local card edits override it; Reset returns
 * to it. No winner is declared between the two answers.
 */
export const useNextDollarStore = create<NextDollarState>((set) => ({
  amount: readInitial(),
  setAmount: (v) => {
    try {
      if (v == null) sessionStorage.removeItem(KEY);
      else sessionStorage.setItem(KEY, String(v));
    } catch {
      // sessionStorage unavailable — in-memory state still drives the UI.
    }
    set({ amount: v });
  },
}));
