import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

/**
 * Persistent multi-select state for donut entity-visibility pickers.
 *
 * We persist the HIDDEN set (not the selected set) so new entities added
 * after a previous toggle still default to visible without needing a
 * "known entities" registry on the side.
 *
 * - No localStorage entry → hidden = ∅, selected = allKeys (all visible).
 * - Stored entry present → selected = allKeys \ (stored ∩ allKeys). Stale
 *   ids (no longer in allKeys) are filtered out before subtraction so they
 *   don't accidentally hide new entities that happen to share an old id.
 * - toggle(k): flips k's membership in the hidden set. Persists.
 * - showAll: empties the hidden set.
 * - hideAll: snapshots current allKeys into the hidden set.
 *
 * Multiple instances of this hook with the same `localStorageKey` stay in
 * lockstep via a module-level pub/sub: whichever instance writes also
 * notifies the others, so a donut and its picker share one logical state
 * without lifting it into a parent or context.
 *
 * @param localStorageKey - e.g. 'donut.assets.hidden'
 * @param allKeys         - current eligible keys (stable string array)
 */
export function useDonutSelection(
  localStorageKey: string,
  allKeys: ReadonlyArray<string>,
): {
  selected: Set<string>;
  toggle: (key: string) => void;
  showAll: () => void;
  hideAll: () => void;
  allShown: boolean;
} {
  // useSyncExternalStore subscribes to the cross-instance pub/sub so a
  // toggle in one instance immediately re-renders consumers of every other
  // instance bound to the same key.
  const rawSnapshot = useSyncExternalStore(
    (cb) => subscribe(localStorageKey, cb),
    () => readRaw(localStorageKey),
    () => '',
  );

  const hidden = useMemo<Set<string>>(() => {
    if (rawSnapshot === '') return new Set();
    try {
      const parsed = JSON.parse(rawSnapshot);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((x): x is string => typeof x === 'string'));
    } catch {
      return new Set();
    }
  }, [rawSnapshot]);

  // selected = allKeys \ (hidden ∩ allKeys) — stale ids in storage are
  // pruned before subtraction so they don't accidentally hide new entities.
  const allKeysSet = useMemo(() => new Set(allKeys), [allKeys]);
  const selected = useMemo(() => {
    const out = new Set<string>();
    for (const k of allKeys) {
      if (!hidden.has(k)) out.add(k);
    }
    return out;
  }, [allKeys, hidden]);
  const allShown = selected.size === allKeysSet.size;

  // Trim stale ids on every render: if storage contains keys that are no
  // longer in allKeys, persist the cleaned set so storage stays tidy.
  useEffect(() => {
    const stale = [...hidden].filter((k) => !allKeysSet.has(k));
    if (stale.length === 0) return;
    const trimmed = [...hidden].filter((k) => allKeysSet.has(k));
    writeHidden(localStorageKey, trimmed);
  }, [hidden, allKeysSet, localStorageKey]);

  const toggle = useCallback(
    (key: string) => {
      const cur = readHiddenSet(localStorageKey);
      if (cur.has(key)) cur.delete(key);
      else cur.add(key);
      writeHidden(localStorageKey, [...cur]);
    },
    [localStorageKey],
  );

  const showAll = useCallback(() => {
    writeHidden(localStorageKey, []);
  }, [localStorageKey]);

  const hideAll = useCallback(() => {
    writeHidden(localStorageKey, [...allKeys]);
  }, [allKeys, localStorageKey]);

  return { selected, toggle, showAll, hideAll, allShown };
}

// --- module-level pub/sub for cross-instance sync ---

const listeners = new Map<string, Set<() => void>>();

function subscribe(key: string, cb: () => void): () => void {
  let bucket = listeners.get(key);
  if (!bucket) {
    bucket = new Set();
    listeners.set(key, bucket);
  }
  bucket.add(cb);
  return () => {
    bucket?.delete(cb);
    if (bucket && bucket.size === 0) listeners.delete(key);
  };
}

function notify(key: string): void {
  const bucket = listeners.get(key);
  if (!bucket) return;
  for (const cb of bucket) cb();
}

function readRaw(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function readHiddenSet(key: string): Set<string> {
  const raw = readRaw(key);
  if (raw === '') return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function writeHidden(key: string, hidden: ReadonlyArray<string>): void {
  if (hidden.length === 0) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, JSON.stringify([...hidden]));
  }
  notify(key);
}
