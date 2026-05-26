import { describe, it, expect, beforeEach } from 'vitest';
import {
  getGranularity,
  setGranularity,
  getTimeWindow,
  setTimeWindow,
  getSelectedEntities,
  setSelectedEntities,
  type SelectedEntity,
} from '@/lib/net-worth-chart-prefs';

describe('net-worth-chart-prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('granularity', () => {
    it('returns null when nothing persisted', () => {
      expect(getGranularity()).toBeNull();
    });

    it('round-trips each granularity option', () => {
      for (const g of ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const) {
        setGranularity(g);
        expect(getGranularity()).toBe(g);
      }
    });

    it('rejects unknown granularity values', () => {
      localStorage.setItem('netWorthChart.granularity', 'CENTURY');
      expect(getGranularity()).toBeNull();
    });
  });

  describe('time window', () => {
    it('returns null when nothing persisted', () => {
      expect(getTimeWindow()).toBeNull();
    });

    it('round-trips each time-window option', () => {
      for (const w of ['3M', '1Y', '5Y', 'ALL'] as const) {
        setTimeWindow(w);
        expect(getTimeWindow()).toBe(w);
      }
    });

    it('rejects unknown time-window values', () => {
      localStorage.setItem('netWorthChart.timeWindow', '10Y');
      expect(getTimeWindow()).toBeNull();
    });
  });

  describe('selected entities', () => {
    it('returns null when nothing persisted', () => {
      expect(getSelectedEntities()).toBeNull();
    });

    it('round-trips a list of entity tuples', () => {
      const sel: SelectedEntity[] = [
        { kind: 'account', id: 1 },
        { kind: 'property', id: 5 },
        { kind: 'vehicle', id: 9 },
        { kind: 'loan', id: 12 },
      ];
      setSelectedEntities(sel);
      expect(getSelectedEntities()).toEqual(sel);
    });

    it('returns null when the persisted value is not an array', () => {
      localStorage.setItem('netWorthChart.selectedEntities', '"not-an-array"');
      expect(getSelectedEntities()).toBeNull();
    });

    it('returns null when an entry has an unknown kind', () => {
      localStorage.setItem(
        'netWorthChart.selectedEntities',
        JSON.stringify([{ kind: 'mystery', id: 1 }]),
      );
      expect(getSelectedEntities()).toBeNull();
    });

    it('returns null when an entry has a non-number id', () => {
      localStorage.setItem(
        'netWorthChart.selectedEntities',
        JSON.stringify([{ kind: 'account', id: 'oops' }]),
      );
      expect(getSelectedEntities()).toBeNull();
    });

    it('returns null when the persisted value is garbage JSON', () => {
      localStorage.setItem('netWorthChart.selectedEntities', '{not json');
      expect(getSelectedEntities()).toBeNull();
    });
  });
});
