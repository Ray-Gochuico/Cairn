import { useLayoutStore, type LayoutEntry, type LayoutHook } from './use-layout-store';

const STORAGE_KEY = 'dashboardWidgetLayout.v1';

/**
 * The widget order BEFORE the asset-value-chart widget shipped (2026-06).
 * A saved layout exactly equal to this (order intact, nothing hidden) means
 * the user never customized — rebuild it to the new defaults so the chart
 * lands in its designed slot instead of appended below the fold. Any other
 * saved layout is respected; reconcile() appends new ids at the end.
 *
 * One-time migration shipped 2026-06; safe to delete once no pre-chart
 * layouts remain in the wild.
 */
const PRE_ASSET_CHART_DEFAULT = ['pills-section', 'spending', 'concentration', 'goals'];

export function migrateUncustomizedLayout(defaultIds: readonly string[]): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    const untouched =
      parsed.length === PRE_ASSET_CHART_DEFAULT.length &&
      parsed.every(
        (e, i) =>
          typeof e === 'object' &&
          e !== null &&
          (e as LayoutEntry).id === PRE_ASSET_CHART_DEFAULT[i] &&
          (e as LayoutEntry).hidden === false,
      );
    if (untouched) {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(defaultIds.map((id) => ({ id, hidden: false }))),
      );
    }
  } catch {
    // localStorage unavailable / corrupt — useLayoutStore handles fallback.
  }
}

export type WidgetLayoutEntry = LayoutEntry;
export type WidgetLayoutHook = LayoutHook;

/**
 * Persistent dashboard-widget order + visibility. Thin wrapper over
 * `useLayoutStore` bound to the widget localStorage key. Pills and widgets
 * are stored independently so reordering one doesn't affect the other.
 */
export function useWidgetLayout(defaultIds: readonly string[]): WidgetLayoutHook {
  // Synchronous, idempotent: after migration the stored list no longer
  // matches the old default, so subsequent renders are no-ops.
  migrateUncustomizedLayout(defaultIds);
  return useLayoutStore(STORAGE_KEY, defaultIds);
}
