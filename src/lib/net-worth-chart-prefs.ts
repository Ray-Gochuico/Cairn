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

const LEGACY_INVESTMENT_KEYS = {
  accounts: 'investment-chart-selected-accounts',
  window: 'investment-chart-time-window',
  granularity: 'investment-chart-granularity',
} as const;

/**
 * One-time port of the retired legacy investment-chart keys into the
 * `investmentChart` makeChartPrefs namespace. The legacy selection was a
 * bare number[] of account ids (incompatible with the SelectedEntity[]
 * shape this module stores), so a namespace reuse à la netWorthChart was
 * impossible — this migration preserves saved selections instead. The
 * legacy window union ('3M'|'1Y'|'5Y'|'ALL') is a subset of TimeWindow, so
 * it ports verbatim; granularity is dropped (derived from the window now).
 * Existing values under the new namespace always win. Idempotent: legacy
 * keys are removed whether or not their values were usable.
 */
export function migrateLegacyInvestmentChartPrefs(): void {
  try {
    const target = makeChartPrefs('investmentChart');

    const rawWindow = localStorage.getItem(LEGACY_INVESTMENT_KEYS.window);
    if (
      rawWindow !== null &&
      target.getTimeWindow() === null &&
      VALID_WINDOWS.has(rawWindow)
    ) {
      target.setTimeWindow(rawWindow as TimeWindow);
    }

    const rawAccounts = localStorage.getItem(LEGACY_INVESTMENT_KEYS.accounts);
    if (rawAccounts !== null && target.getSelectedEntities() === null) {
      try {
        const parsed: unknown = JSON.parse(rawAccounts);
        if (
          Array.isArray(parsed) &&
          parsed.every((v): v is number => typeof v === 'number')
        ) {
          target.setSelectedEntities(
            parsed.map((id) => ({ kind: 'account' as const, id })),
          );
        }
      } catch {
        // corrupt legacy JSON — fall through to the key removal below
      }
    }

    localStorage.removeItem(LEGACY_INVESTMENT_KEYS.accounts);
    localStorage.removeItem(LEGACY_INVESTMENT_KEYS.window);
    localStorage.removeItem(LEGACY_INVESTMENT_KEYS.granularity);
  } catch {
    // localStorage unavailable — defaults apply, nothing to migrate
  }
}
