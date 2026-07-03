import { useLayoutStore, type LayoutEntry, type LayoutHook } from './use-layout-store';

const STORAGE_KEY = 'dashboardWidgetLayout.v1';

/**
 * Widget orders that mean "the user never customized". Two generations:
 * the pre-asset-chart default (2026-06 migration target) and the 5-id
 * default users held between the chart shipping and the trivia widget
 * (2026-07). A saved layout exactly equal to EITHER (order intact,
 * nothing hidden) is rebuilt to the current defaults so new widgets land
 * in their designed slots. Anything else is customized and respected —
 * reconcile() appends unknown ids at the end.
 */
const PRISTINE_DEFAULTS: readonly (readonly string[])[] = [
  ['pills-section', 'spending', 'concentration', 'goals'],
  ['pills-section', 'asset-value-chart', 'spending', 'concentration', 'goals'],
];

export function migrateUncustomizedLayout(defaultIds: readonly string[]): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    const matchesPristine = (pristine: readonly string[]) =>
      parsed.length === pristine.length &&
      parsed.every(
        (e, i) =>
          typeof e === 'object' &&
          e !== null &&
          (e as LayoutEntry).id === pristine[i] &&
          (e as LayoutEntry).hidden === false,
      );
    if (PRISTINE_DEFAULTS.some(matchesPristine)) {
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
