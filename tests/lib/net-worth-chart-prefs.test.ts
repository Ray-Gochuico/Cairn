import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeChartPrefs,
  migrateLegacyInvestmentChartPrefs,
  type SelectedEntity,
} from '@/lib/net-worth-chart-prefs';

describe('makeChartPrefs', () => {
  beforeEach(() => localStorage.clear());

  it('namespaces keys so two surfaces are independent', () => {
    const a = makeChartPrefs('netWorthChart');
    const b = makeChartPrefs('dashboardAssetChart');
    a.setTimeWindow('5Y');
    b.setTimeWindow('6M');
    expect(a.getTimeWindow()).toBe('5Y');
    expect(b.getTimeWindow()).toBe('6M');
    expect(localStorage.getItem('dashboardAssetChart.timeWindow')).toBe('6M');
  });

  it('reads pre-existing netWorthChart keys (selection carries over)', () => {
    localStorage.setItem('netWorthChart.selectedEntities', JSON.stringify([{ kind: 'account', id: 3 }]));
    expect(makeChartPrefs('netWorthChart').getSelectedEntities()).toEqual([{ kind: 'account', id: 3 }]);
  });

  it('reads a pre-existing 6M window saved under netWorthChart (widened union)', () => {
    // The old chart's reader once accepted a narrower window union; a '6M'
    // persisted under the shared netWorthChart key must round-trip through
    // the factory so saved selections never regress on the netWorth surface.
    localStorage.setItem('netWorthChart.timeWindow', '6M');
    expect(makeChartPrefs('netWorthChart').getTimeWindow()).toBe('6M');
  });

  it('accepts the full window union including 3M, 6M, YTD', () => {
    const p = makeChartPrefs('x');
    for (const w of ['3M', '6M', 'YTD', '1Y', '5Y', 'ALL'] as const) {
      p.setTimeWindow(w);
      expect(p.getTimeWindow()).toBe(w);
    }
  });

  it('returns null for garbage window or selection values', () => {
    localStorage.setItem('x.timeWindow', '2W');
    localStorage.setItem('x.selectedEntities', '{"not":"an array"}');
    const p = makeChartPrefs('x');
    expect(p.getTimeWindow()).toBeNull();
    expect(p.getSelectedEntities()).toBeNull();
  });

  it('returns null for the time window on a fresh namespace', () => {
    expect(makeChartPrefs('fresh').getTimeWindow()).toBeNull();
  });

  it('returns null for selected entities on a fresh namespace (!raw guard)', () => {
    expect(makeChartPrefs('untouched').getSelectedEntities()).toBeNull();
  });

  it('round-trips a list of entity tuples', () => {
    const p = makeChartPrefs('x');
    const sel: SelectedEntity[] = [
      { kind: 'account', id: 1 },
      { kind: 'property', id: 5 },
      { kind: 'vehicle', id: 9 },
      { kind: 'loan', id: 12 },
    ];
    p.setSelectedEntities(sel);
    expect(p.getSelectedEntities()).toEqual(sel);
  });

  it('returns null when an entry has an unknown kind', () => {
    localStorage.setItem(
      'x.selectedEntities',
      JSON.stringify([{ kind: 'mystery', id: 1 }]),
    );
    expect(makeChartPrefs('x').getSelectedEntities()).toBeNull();
  });

  it('returns null when an entry has a non-number id', () => {
    localStorage.setItem(
      'x.selectedEntities',
      JSON.stringify([{ kind: 'account', id: 'oops' }]),
    );
    expect(makeChartPrefs('x').getSelectedEntities()).toBeNull();
  });

  it('returns null when the persisted value is garbage JSON', () => {
    localStorage.setItem('x.selectedEntities', '{not json');
    expect(makeChartPrefs('x').getSelectedEntities()).toBeNull();
  });
});

describe('migrateLegacyInvestmentChartPrefs', () => {
  beforeEach(() => localStorage.clear());

  it('ports the legacy number[] selection into investmentChart.selectedEntities and removes the legacy keys', () => {
    localStorage.setItem('investment-chart-selected-accounts', JSON.stringify([3, 7]));
    localStorage.setItem('investment-chart-time-window', '5Y');
    localStorage.setItem('investment-chart-granularity', 'MONTH');
    migrateLegacyInvestmentChartPrefs();
    const p = makeChartPrefs('investmentChart');
    expect(p.getSelectedEntities()).toEqual([
      { kind: 'account', id: 3 },
      { kind: 'account', id: 7 },
    ]);
    expect(p.getTimeWindow()).toBe('5Y');
    expect(localStorage.getItem('investment-chart-selected-accounts')).toBeNull();
    expect(localStorage.getItem('investment-chart-time-window')).toBeNull();
    expect(localStorage.getItem('investment-chart-granularity')).toBeNull();
  });

  it('never clobbers values already saved under the new namespace', () => {
    localStorage.setItem('investment-chart-selected-accounts', JSON.stringify([3]));
    localStorage.setItem('investment-chart-time-window', '1Y');
    const p = makeChartPrefs('investmentChart');
    p.setSelectedEntities([{ kind: 'account', id: 99 }]);
    p.setTimeWindow('6M');
    migrateLegacyInvestmentChartPrefs();
    expect(p.getSelectedEntities()).toEqual([{ kind: 'account', id: 99 }]);
    expect(p.getTimeWindow()).toBe('6M');
    // Legacy keys are still cleaned up.
    expect(localStorage.getItem('investment-chart-selected-accounts')).toBeNull();
  });

  it('is a no-op (and idempotent) with no legacy keys present', () => {
    migrateLegacyInvestmentChartPrefs();
    migrateLegacyInvestmentChartPrefs();
    const p = makeChartPrefs('investmentChart');
    expect(p.getSelectedEntities()).toBeNull();
    expect(p.getTimeWindow()).toBeNull();
  });

  it('tolerates garbage legacy values: drops them, still removes the keys', () => {
    localStorage.setItem('investment-chart-selected-accounts', '{"not":"an array"}');
    localStorage.setItem('investment-chart-time-window', '2W');
    migrateLegacyInvestmentChartPrefs();
    const p = makeChartPrefs('investmentChart');
    expect(p.getSelectedEntities()).toBeNull();
    expect(p.getTimeWindow()).toBeNull();
    expect(localStorage.getItem('investment-chart-selected-accounts')).toBeNull();
    expect(localStorage.getItem('investment-chart-time-window')).toBeNull();
  });
});
