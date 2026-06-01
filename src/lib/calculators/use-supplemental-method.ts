import { useCallback, useEffect, useState } from 'react';

export type SupplementalMethod = 'AGGREGATE' | 'FLAT';

const keyFor = (cardId: string) => `calc-suppl-method:${cardId}`;

function read(cardId: string): SupplementalMethod {
  try {
    return sessionStorage.getItem(keyFor(cardId)) === 'FLAT' ? 'FLAT' : 'AGGREGATE';
  } catch {
    return 'AGGREGATE';
  }
}

/** Per-card supplemental-wage withholding method, persisted in sessionStorage.
 *  Kept out of useCalculatorState so flipping the method doesn't set isOverridden. */
export function useSupplementalMethod(
  cardId: string,
): [SupplementalMethod, (m: SupplementalMethod) => void] {
  const [method, setMethod] = useState<SupplementalMethod>(() => read(cardId));
  useEffect(() => {
    setMethod(read(cardId));
  }, [cardId]);
  const set = useCallback(
    (m: SupplementalMethod) => {
      setMethod(m);
      try {
        sessionStorage.setItem(keyFor(cardId), m);
      } catch {
        // sessionStorage unavailable — in-memory state still drives the UI.
      }
    },
    [cardId],
  );
  return [method, set];
}
