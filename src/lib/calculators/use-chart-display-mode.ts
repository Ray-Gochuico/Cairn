import { useCallback, useEffect, useState } from 'react';

export type ChartDisplayMode = 'NOMINAL' | 'REAL';

const keyFor = (cardId: string) => `calc-display-mode:${cardId}`;

function read(cardId: string): ChartDisplayMode {
  try {
    return sessionStorage.getItem(keyFor(cardId)) === 'REAL' ? 'REAL' : 'NOMINAL';
  } catch {
    return 'NOMINAL';
  }
}

/** Per-card chart Nominal/Real toggle, persisted in sessionStorage. Kept out of
 *  useCalculatorState so flipping the view does not set isOverridden. */
export function useChartDisplayMode(
  cardId: string,
): [ChartDisplayMode, (mode: ChartDisplayMode) => void] {
  const [mode, setMode] = useState<ChartDisplayMode>(() => read(cardId));

  useEffect(() => {
    setMode(read(cardId));
  }, [cardId]);

  const set = useCallback(
    (m: ChartDisplayMode) => {
      setMode(m);
      try {
        sessionStorage.setItem(keyFor(cardId), m);
      } catch {
        // sessionStorage unavailable — in-memory state still drives the UI.
      }
    },
    [cardId],
  );

  return [mode, set];
}
