import { useCallback, useEffect, useState } from 'react';

export interface LayoutEntry {
  id: string;
  hidden: boolean;
}

export interface LayoutHook {
  layout: LayoutEntry[];
  hidden: (id: string) => boolean;
  move: (id: string, delta: -1 | 1) => void;
  hide: (id: string) => void;
  show: (id: string) => void;
  reset: () => void;
}

/**
 * Shared persistent layout store for dashboard pills and widgets. Order +
 * visibility are stored against `storageKey`; the stored list is reconciled
 * with `defaultIds` on mount so new ids land at the end and removed ids drop
 * out. Storage is plain localStorage rather than the AppSettings schema to
 * avoid a schema migration for a per-device preference.
 */
export function useLayoutStore(
  storageKey: string,
  defaultIds: readonly string[],
): LayoutHook {
  const [layout, setLayout] = useState<LayoutEntry[]>(() =>
    buildInitial(storageKey, defaultIds),
  );

  // Re-reconcile when the default-id list changes by content. Keys on the
  // joined string rather than the array reference itself — callers commonly
  // pass a new array literal per render, and array-identity would loop us
  // through setState → re-render → effect → setState forever.
  const defaultKey = defaultIds.join('|');
  useEffect(() => {
    setLayout((current) => {
      const next = reconcile(current, defaultIds);
      if (sameLayout(current, next)) return current;
      return next;
    });
    // defaultIds is intentionally read but the effect keys on defaultKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      // localStorage may be unavailable (SSR, privacy mode); silently skip.
    }
  }, [layout, storageKey]);

  const move = useCallback((id: string, delta: -1 | 1) => {
    setLayout((current) => {
      const idx = current.findIndex((e) => e.id === id);
      if (idx < 0) return current;
      const target = idx + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const setHidden = useCallback((id: string, hiddenValue: boolean) => {
    setLayout((current) =>
      current.map((e) => (e.id === id ? { ...e, hidden: hiddenValue } : e)),
    );
  }, []);

  const hide = useCallback((id: string) => setHidden(id, true), [setHidden]);
  const show = useCallback((id: string) => setHidden(id, false), [setHidden]);

  const reset = useCallback(() => {
    setLayout(defaultIds.map((id) => ({ id, hidden: false })));
  }, [defaultIds]);

  const hidden = useCallback(
    (id: string) => layout.find((e) => e.id === id)?.hidden ?? false,
    [layout],
  );

  return { layout, hidden, move, hide, show, reset };
}

function buildInitial(
  storageKey: string,
  defaultIds: readonly string[],
): LayoutEntry[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultIds.map((id) => ({ id, hidden: false }));
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultIds.map((id) => ({ id, hidden: false }));
    const sanitized = parsed.filter(
      (e): e is LayoutEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as { id?: unknown }).id === 'string' &&
        typeof (e as { hidden?: unknown }).hidden === 'boolean',
    );
    return reconcile(sanitized, defaultIds);
  } catch {
    return defaultIds.map((id) => ({ id, hidden: false }));
  }
}

function reconcile(
  current: LayoutEntry[],
  defaultIds: readonly string[],
): LayoutEntry[] {
  const known = new Set(defaultIds);
  const present = new Set(current.map((e) => e.id));
  const kept = current.filter((e) => known.has(e.id));
  const additions = defaultIds
    .filter((id) => !present.has(id))
    .map((id) => ({ id, hidden: false }));
  return [...kept, ...additions];
}

function sameLayout(a: LayoutEntry[], b: LayoutEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id || a[i].hidden !== b[i].hidden) return false;
  }
  return true;
}
