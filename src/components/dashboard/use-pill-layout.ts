import { useLayoutStore, type LayoutEntry, type LayoutHook } from './use-layout-store';

const STORAGE_KEY = 'dashboardPillLayout.v1';

export type PillLayoutEntry = LayoutEntry;
export type PillLayoutHook = LayoutHook;

/**
 * Persistent dashboard-pill order + visibility. Thin wrapper over
 * `useLayoutStore` bound to the pill localStorage key.
 */
export function usePillLayout(defaultIds: readonly string[]): PillLayoutHook {
  return useLayoutStore(STORAGE_KEY, defaultIds);
}
