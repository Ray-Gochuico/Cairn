import { useLayoutStore, type LayoutEntry, type LayoutHook } from './use-layout-store';

const STORAGE_KEY = 'dashboardWidgetLayout.v1';

export type WidgetLayoutEntry = LayoutEntry;
export type WidgetLayoutHook = LayoutHook;

/**
 * Persistent dashboard-widget order + visibility. Thin wrapper over
 * `useLayoutStore` bound to the widget localStorage key. Pills (metric chips)
 * and widgets (donut, concentration card, goals strip, etc.) are stored
 * independently so a user reordering one doesn't affect the other.
 */
export function useWidgetLayout(defaultIds: readonly string[]): WidgetLayoutHook {
  return useLayoutStore(STORAGE_KEY, defaultIds);
}
