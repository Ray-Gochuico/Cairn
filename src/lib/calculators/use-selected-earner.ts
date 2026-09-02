import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { prefKey } from '@/lib/explore-mode';

export const EARNER_KEY_PREFIX = 'calc-earner:';
// W4 review (MAJOR 1): the stored VALUE is a person id, which the post-exit
// real DB reissues from 1 — a sample-era pick would silently scope a real
// card to the wrong earner.
const keyFor = (cardId: string) => prefKey(`${EARNER_KEY_PREFIX}${cardId}`);

/** Wave B (D-B9): explicit-Combined sentinel. Distinct from key-absent so a
 *  person page-scope (defaultId = the person) can still be overridden to
 *  Combined per-card. Only cards passing `explicitCombined` write it. */
const COMBINED = 'combined';

// ── Wave B (D-B9): pick epoch ───────────────────────────────────────────────
// clearEarnerPicks() removes the sessionStorage keys, but mounted hooks hold
// the stored pick in React state — the epoch is the external signal that
// makes them re-read. Bumped only by clearEarnerPicks (scope changes).
let earnerEpoch = 0;
const epochListeners = new Set<() => void>();
export function getEarnerEpoch(): number {
  return earnerEpoch;
}
export function subscribeEarnerEpoch(listener: () => void): () => void {
  epochListeners.add(listener);
  return () => epochListeners.delete(listener);
}

/** Remove every per-card earner pick (page-scope broadcast wins — precedence
 *  rule 2) and bump the epoch so mounted hooks re-read. */
export function clearEarnerPicks(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(prefKey(EARNER_KEY_PREFIX))) stale.push(k);
    }
    stale.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // sessionStorage unavailable — the epoch bump still resets mounted hooks.
  }
  earnerEpoch += 1;
  epochListeners.forEach((l) => l());
}

function read(cardId: string): number | typeof COMBINED | null {
  try {
    const raw = sessionStorage.getItem(keyFor(cardId));
    if (raw == null) return null;
    if (raw === COMBINED) return COMBINED;
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
 * `set(null)` clears the stored choice; with `opts.explicitCombined` it
 * instead stores the 'combined' sentinel (Wave B D-B9) so Combined remains
 * pickable when the page scope makes `defaultId` a person. Scope changes
 * clear all picks via clearEarnerPicks(); the epoch re-syncs mounted hooks.
 */
export function useSelectedEarner(
  cardId: string,
  defaultId: number | null,
  eligibleIds: ReadonlyArray<number>,
  opts?: { explicitCombined?: boolean },
): [number | null, (id: number | null) => void] {
  const epoch = useSyncExternalStore(subscribeEarnerEpoch, getEarnerEpoch);
  const [stored, setStored] = useState<number | typeof COMBINED | null>(() => read(cardId));
  useEffect(() => {
    setStored(read(cardId));
  }, [cardId, epoch]);
  const explicitCombined = opts?.explicitCombined === true;
  const set = useCallback(
    (id: number | null) => {
      const persisted = id == null && explicitCombined ? COMBINED : id;
      setStored(persisted);
      try {
        if (persisted == null) sessionStorage.removeItem(keyFor(cardId));
        else sessionStorage.setItem(keyFor(cardId), String(persisted));
      } catch {
        // sessionStorage unavailable — in-memory state still drives the UI.
      }
    },
    [cardId, explicitCombined],
  );
  const selected =
    stored === COMBINED
      ? null
      : stored != null && eligibleIds.includes(stored)
        ? stored
        : defaultId;
  return [selected, set];
}
