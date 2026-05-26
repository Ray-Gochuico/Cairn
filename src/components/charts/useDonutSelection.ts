import { useCallback, useEffect, useMemo, useState } from 'react';

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
  // Initial hidden set is hydrated from localStorage. JSON parse errors and
  // missing entries fall back to an empty set so the user is never locked
  // into a broken state by a corrupted storage value.
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(localStorageKey);
      if (raw === null) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((x): x is string => typeof x === 'string'));
    } catch {
      return new Set();
    }
  });

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

  // Persist when hidden changes. JSON-stringify only the keys that still
  // belong to allKeys so storage stays tidy and stale ids drop out on the
  // next mutation.
  useEffect(() => {
    const trimmed = [...hidden].filter((k) => allKeysSet.has(k));
    if (trimmed.length === 0) {
      localStorage.removeItem(localStorageKey);
    } else {
      localStorage.setItem(localStorageKey, JSON.stringify(trimmed));
    }
  }, [hidden, allKeysSet, localStorageKey]);

  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const showAll = useCallback(() => {
    setHidden(new Set());
  }, []);

  const hideAll = useCallback(() => {
    setHidden(new Set(allKeys));
  }, [allKeys]);

  return { selected, toggle, showAll, hideAll, allShown };
}
