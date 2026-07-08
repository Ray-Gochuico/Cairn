import { useEffect, useState } from 'react';
import { localTodayISO } from '@/lib/trivia/daily';

/**
 * The LOCAL calendar day (YYYY-MM-DD) as reactive state (Wave 8 SHOULD-5):
 * a Learn tab left open across midnight must re-derive its daily set rather
 * than keep serving yesterday's. Re-checks on visibilitychange (the common
 * "came back the next morning" path) and on a 60 s interval (the "left it
 * focused overnight" path). Cheap: one string compare per tick; the setState
 * updater returns the previous value on a same-day tick, so React bails and
 * consumers only re-render on a real day flip.
 */
export function useLocalToday(): string {
  const [today, setToday] = useState(() => localTodayISO());
  useEffect(() => {
    const check = () =>
      setToday((prev) => {
        const now = localTodayISO();
        return now === prev ? prev : now;
      });
    const id = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return today;
}
