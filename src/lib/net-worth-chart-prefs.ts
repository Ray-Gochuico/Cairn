// src/lib/net-worth-chart-prefs.ts
import type { Granularity, TimeWindow } from './snapshot-bucketing';

const STORAGE_KEY_GRANULARITY = 'netWorthChart.granularity';
const STORAGE_KEY_TIME_WINDOW = 'netWorthChart.timeWindow';
const STORAGE_KEY_SELECTED_ENTITIES = 'netWorthChart.selectedEntities';

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
    if (raw === '3M' || raw === '1Y' || raw === '5Y' || raw === 'ALL') return raw;
    return null;
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
