import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'dashboardPillLayout.v1';

export interface PillLayoutEntry {
  id: string;
  hidden: boolean;
}

export interface PillLayoutHook {
  layout: PillLayoutEntry[];
  hidden: (id: string) => boolean;
  move: (id: string, delta: -1 | 1) => void;
  hide: (id: string) => void;
  show: (id: string) => void;
  reset: () => void;
}

/**
 * Persistent dashboard-pill order + visibility. The default order comes from
 * `defaultIds` — that list also defines which pills exist. localStorage stores
 * an override; on load we reconcile the stored list with `defaultIds` so any
 * new pill added in code shows up at the end of the user's order, and any
 * stale entry is dropped. Storage is plain localStorage rather than the
 * AppSettings schema to avoid a schema migration for a per-device preference.
 */
export function usePillLayout(defaultIds: readonly string[]): PillLayoutHook {
  const [layout, setLayout] = useState<PillLayoutEntry[]>(() => buildInitial(defaultIds));

  // Reconcile against the default list when its *contents* change (e.g. a
  // new pill is added to the dashboard in code). Hooked on the joined string
  // rather than the array reference itself — callers commonly pass a new
  // array literal per render, and array-identity would loop us through
  // setState → re-render → effect → setState forever.
  const defaultKey = defaultIds.join('|');
  useEffect(() => {
    setLayout((current) => {
      const next = reconcile(current, defaultIds);
      // Bail out if reconcile() didn't actually change anything — guards
      // against returning a new array reference for an identical state,
      // which would otherwise re-trigger our persist effect on every render.
      if (sameLayout(current, next)) return current;
      return next;
    });
    // defaultIds is intentionally read but the effect keys on defaultKey
    // (a stable string snapshot of its contents).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultKey]);

  // Persist on every change after first paint.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // localStorage may be unavailable (SSR, privacy mode); silently skip.
    }
  }, [layout]);

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

function buildInitial(defaultIds: readonly string[]): PillLayoutEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultIds.map((id) => ({ id, hidden: false }));
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultIds.map((id) => ({ id, hidden: false }));
    const sanitized = parsed.filter(
      (e): e is PillLayoutEntry =>
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
  current: PillLayoutEntry[],
  defaultIds: readonly string[],
): PillLayoutEntry[] {
  const known = new Set(defaultIds);
  const present = new Set(current.map((e) => e.id));
  const kept = current.filter((e) => known.has(e.id));
  const additions = defaultIds
    .filter((id) => !present.has(id))
    .map((id) => ({ id, hidden: false }));
  return [...kept, ...additions];
}

function sameLayout(a: PillLayoutEntry[], b: PillLayoutEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id || a[i].hidden !== b[i].hidden) return false;
  }
  return true;
}
