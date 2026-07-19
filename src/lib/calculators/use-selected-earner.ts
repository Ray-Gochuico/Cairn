import { useCallback, useEffect, useState } from 'react';

const keyFor = (cardId: string) => `calc-earner:${cardId}`;

function read(cardId: string): number | null {
  try {
    const raw = sessionStorage.getItem(keyFor(cardId));
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Per-card selected-earner id, persisted in sessionStorage (the
 * useSupplementalMethod pattern — kept out of useCalculatorState so picking
 * a person doesn't set isOverridden). `eligibleIds` guards against a stored
 * id whose person was deleted mid-session: falls back to `defaultId`.
 * `set(null)` clears the stored choice (Paycheck's "Combined" segment —
 * with a null defaultId that IS the Combined state).
 */
export function useSelectedEarner(
  cardId: string,
  defaultId: number | null,
  eligibleIds: ReadonlyArray<number>,
): [number | null, (id: number | null) => void] {
  const [stored, setStored] = useState<number | null>(() => read(cardId));
  useEffect(() => {
    setStored(read(cardId));
  }, [cardId]);
  const set = useCallback(
    (id: number | null) => {
      setStored(id);
      try {
        if (id == null) sessionStorage.removeItem(keyFor(cardId));
        else sessionStorage.setItem(keyFor(cardId), String(id));
      } catch {
        // sessionStorage unavailable — in-memory state still drives the UI.
      }
    },
    [cardId],
  );
  const selected = stored != null && eligibleIds.includes(stored) ? stored : defaultId;
  return [selected, set];
}
