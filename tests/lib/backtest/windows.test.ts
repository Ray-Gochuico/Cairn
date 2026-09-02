import { describe, expect, it } from 'vitest';
import { STRESS_WINDOWS } from '@/lib/backtest/windows';
import { loadShillerAnnual } from '@/data/shiller-schema';

describe('STRESS_WINDOWS registry (D-W1-8)', () => {
  it('ships exactly the five approved windows, in roster order, with the pinned spans', () => {
    expect(STRESS_WINDOWS.map((w) => [w.id, w.span.startYear, w.span.endYear])).toEqual([
      ['depression-1929', 1929, 1931],
      ['stagflation-1973', 1973, 1981],
      ['dotcom-2000', 2000, 2002],
      ['gfc-2008', 2008, 2008],
      ['inflation-2022', 2022, 2022],
    ]);
  });

  it('ids are unique; labels and blurbs are non-empty; spans are ordered', () => {
    const ids = STRESS_WINDOWS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const w of STRESS_WINDOWS) {
      expect(w.label.length).toBeGreaterThan(0);
      expect(w.blurb.length).toBeGreaterThan(0);
      expect(w.span.startYear).toBeLessThanOrEqual(w.span.endYear);
    }
  });

  it('every shipped span is inside the bundled dataset (CP-24 can only fire on future roster edits)', () => {
    const rows = loadShillerAnnual();
    const first = rows[0].year;
    const last = rows[rows.length - 1].year;
    for (const w of STRESS_WINDOWS) {
      expect(w.span.startYear).toBeGreaterThanOrEqual(first);
      expect(w.span.endYear).toBeLessThanOrEqual(last);
    }
  });

  it('labels are the approved names (copy contract CP-2)', () => {
    expect(STRESS_WINDOWS.map((w) => w.label)).toEqual([
      'The 1929 crash',
      'The 1970s inflation run',
      'The dot-com crash',
      'The 2008 crash',
      'The 2022 inflation shock',
    ]);
  });
});
