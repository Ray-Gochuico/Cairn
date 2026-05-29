import { useCallback, useEffect, useMemo, useState } from 'react';

const keyFor = (cardId: string) => `calc-state:${cardId}`;

function readOverrides(cardId: string): Record<string, unknown> {
  try {
    const raw = sessionStorage.getItem(keyFor(cardId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeOverrides(cardId: string, overrides: Record<string, unknown>): void {
  try {
    if (Object.keys(overrides).length === 0) sessionStorage.removeItem(keyFor(cardId));
    else sessionStorage.setItem(keyFor(cardId), JSON.stringify(overrides));
  } catch {
    // sessionStorage unavailable (private mode / SSR) — in-memory state still drives the UI.
  }
}

/**
 * Per-card editable input state. `defaults` are the user's real-data prefills
 * (recomputed by the caller from the stores). The user can override any field;
 * overrides persist per `cardId` for the session and win over defaults on
 * rehydrate. `reset()` clears overrides and returns to the current defaults.
 */
export function useCalculatorState<T extends Record<string, unknown>>(
  cardId: string,
  defaults: T,
): {
  values: T;
  setValue: <K extends keyof T>(key: K, value: T[K]) => void;
  reset: () => void;
  isOverridden: boolean;
} {
  const [overrides, setOverrides] = useState<Partial<T>>(() => readOverrides(cardId) as Partial<T>);

  // Reload overrides if the consumer re-renders with a different cardId, so one
  // card's persisted edits never leak into another's state.
  useEffect(() => {
    setOverrides(readOverrides(cardId) as Partial<T>);
  }, [cardId]);

  const values = useMemo(() => ({ ...defaults, ...overrides }), [defaults, overrides]);

  const setValue = useCallback(
    <K extends keyof T>(key: K, value: T[K]) => {
      setOverrides((prev) => {
        const next = { ...prev, [key]: value };
        writeOverrides(cardId, next as Record<string, unknown>);
        return next;
      });
    },
    [cardId],
  );

  const reset = useCallback(() => {
    setOverrides({});
    writeOverrides(cardId, {});
  }, [cardId]);

  const isOverridden = useMemo(() => Object.keys(overrides).length > 0, [overrides]);

  return { values, setValue, reset, isOverridden };
}
