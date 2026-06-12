// src/lib/net-worth-chart-prefs.ts
import type { Granularity, TimeWindow } from './snapshot-bucketing';

const STORAGE_KEY_GRANULARITY = 'netWorthChart.granularity';
const STORAGE_KEY_TIME_WINDOW = 'netWorthChart.timeWindow';
const STORAGE_KEY_SELECTED_ENTITIES = 'netWorthChart.selectedEntities';

const VALID_WINDOWS: ReadonlySet<string> = new Set(
  ['3M', '6M', 'YTD', '1Y', '5Y', 'ALL'] satisfies readonly TimeWindow[],
);

/**
 * Persisted preferences for the Net Worth time-series chart. Mirrors
 * `investment-chart-prefs.ts` but uses a `netWorthChart.*` localStorage
 * namespace so the two charts can hold independent selections.
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

export function getGranularity(): Granularity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GRANULARITY);
    if (
      raw === 'DAY' ||
      raw === 'WEEK' ||
      raw === 'MONTH' ||
      raw === 'QUARTER' ||
      raw === 'YEAR'
    ) {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

export function setGranularity(g: Granularity): void {
  try {
    localStorage.setItem(STORAGE_KEY_GRANULARITY, g);
  } catch {
    // ignore
  }
}

export function getTimeWindow(): TimeWindow | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TIME_WINDOW);
    // Widened to the full union so the legacy reader and makeChartPrefs can
    // never disagree on the shared netWorthChart key (transitional — this
    // whole legacy block is deleted when the old chart goes away).
    return raw !== null && VALID_WINDOWS.has(raw) ? (raw as TimeWindow) : null;
  } catch {
    return null;
  }
}

export function setTimeWindow(w: TimeWindow): void {
  try {
    localStorage.setItem(STORAGE_KEY_TIME_WINDOW, w);
  } catch {
    // ignore
  }
}

export function getSelectedEntities(): SelectedEntity[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SELECTED_ENTITIES);
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
}

export function setSelectedEntities(entities: SelectedEntity[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY_SELECTED_ENTITIES,
      JSON.stringify(entities),
    );
  } catch {
    // ignore
  }
}

export interface ChartPrefs {
  getTimeWindow(): TimeWindow | null;
  setTimeWindow(w: TimeWindow): void;
  getSelectedEntities(): SelectedEntity[] | null;
  setSelectedEntities(entities: SelectedEntity[]): void;
}

/**
 * Namespace-parameterized chart preferences. `makeChartPrefs('netWorthChart')`
 * reads/writes the SAME keys the legacy named exports use, so existing saved
 * selections carry over to the AssetValueChart's netWorth surface; the
 * dashboard surface uses 'dashboardAssetChart'. Granularity is intentionally
 * absent — the new chart derives it from the window (old granularity keys are
 * orphaned in storage, harmlessly).
 *
 * @param namespace — known namespaces: 'netWorthChart' (legacy-compatible) and
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
