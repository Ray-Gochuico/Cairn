// src/lib/net-worth-chart-prefs.ts
import type { TimeWindow } from './snapshot-bucketing';

const VALID_WINDOWS: ReadonlySet<string> = new Set(
  ['3M', '6M', 'YTD', '1Y', '5Y', 'ALL'] satisfies readonly TimeWindow[],
);

/**
 * Persisted preferences for the AssetValueChart, parameterized by surface
 * namespace (see `makeChartPrefs`).
 *
 * `SelectedEntity` is a discriminated union of `{kind, id}` tuples — one
 * per kind of asset/liability that can sit in the chart's grouped picker.
 * See also `entity-key.ts` for the string-form (`"account:42"`) that drives
 * recharts `dataKey` values.
 */
export type EntityKind = 'account' | 'property' | 'vehicle' | 'loan';
export interface SelectedEntity {
  kind: EntityKind;
  id: number;
}

const ENTITY_KINDS: ReadonlySet<EntityKind> = new Set([
  'account',
  'property',
  'vehicle',
  'loan',
]);

export interface ChartPrefs {
  getTimeWindow(): TimeWindow | null;
  setTimeWindow(w: TimeWindow): void;
  getSelectedEntities(): SelectedEntity[] | null;
  setSelectedEntities(entities: SelectedEntity[]): void;
}

/**
 * Namespace-parameterized chart preferences. `makeChartPrefs('netWorthChart')`
 * reads/writes the same localStorage keys the pre-AssetValueChart page chart
 * used, so selections saved before the swap carry over to the netWorth
 * surface; the dashboard surface uses 'dashboardAssetChart'. Granularity is
 * intentionally absent — the chart derives it from the window (old
 * `netWorthChart.granularity` keys are orphaned in storage, harmlessly).
 *
 * @param namespace — known namespaces: 'netWorthChart' and
 *   'dashboardAssetChart'; any other string creates fresh keys with no
 *   carry-over.
 */
export function makeChartPrefs(namespace: string): ChartPrefs {
  const windowKey = `${namespace}.timeWindow`;
  const selectionKey = `${namespace}.selectedEntities`;
  return {
    getTimeWindow() {
      try {
        const raw = localStorage.getItem(windowKey);
        return raw !== null && VALID_WINDOWS.has(raw) ? (raw as TimeWindow) : null;
      } catch {
        return null;
      }
    },
    setTimeWindow(w) {
      try {
        localStorage.setItem(windowKey, w);
      } catch {
        // ignore
      }
    },
    getSelectedEntities() {
      try {
        const raw = localStorage.getItem(selectionKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        const out: SelectedEntity[] = [];
        for (const item of parsed) {
          if (
            item === null ||
            typeof item !== 'object' ||
            typeof item.id !== 'number' ||
            typeof item.kind !== 'string' ||
            !ENTITY_KINDS.has(item.kind as EntityKind)
          ) {
            return null;
          }
          out.push({ kind: item.kind as EntityKind, id: item.id });
        }
        return out;
      } catch {
        return null;
      }
    },
    setSelectedEntities(entities) {
      try {
        localStorage.setItem(
          selectionKey,
          JSON.stringify(entities),
        );
      } catch {
        // ignore
      }
    },
  };
}
