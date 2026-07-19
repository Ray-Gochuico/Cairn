import { createContext, useContext } from 'react';

/**
 * Wave-17 shell contract between CalculatorsLayout and CalculatorCard.
 * ONE open card at a time (openId) — the accordion invariant lives in the
 * provider, not the cards. Deliberately NOT extensible to multi-open
 * (pin/multi-open is an explicit non-goal).
 */
export interface CalculatorShellApi {
  openId: string | null;
  /** Open a card (implicitly closing any other) or pass null to close. */
  setOpenId: (id: string | null) => void;
  /** Persist hidden:true via settings.calculatorCardLayout (withCardHidden path). */
  hideCard: (id: string) => void;
}

const CalculatorShellContext = createContext<CalculatorShellApi | null>(null);

export const CalculatorShellProvider = CalculatorShellContext.Provider;

/**
 * null (no provider — standalone/test render) → CalculatorCard renders OPEN
 * with inert shell chrome, mirroring the old defaultExpanded=true so the 12
 * per-card test suites don't need a provider harness.
 */
export function useCalculatorShell(): CalculatorShellApi | null {
  return useContext(CalculatorShellContext);
}
