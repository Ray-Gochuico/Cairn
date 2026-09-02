import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPOUND_CADENCE_CAPTION,
  FAN_LEGEND_BAND,
  FAN_LEGEND_MEDIAN,
  HISTORY_CHART_LABEL_COMPOUND,
  HISTORY_CHART_LABEL_PATH_TO_FI,
  RETURN_SOURCE_ASSUMED_LABEL,
  RETURN_SOURCE_GROUP_LABEL,
  RETURN_SOURCE_HISTORY_LABEL,
  fanCaption,
  holdsLineKeep,
  holdsLineStop,
  noStretchLine,
  tooFewStretchesLine,
} from '@/lib/calculators/history-fan-copy';
import { TODAY_SUFFIX } from '@/lib/calculators/basis-view';

describe('history-fan copy contract (byte-exact)', () => {
  it('CH-1 KEEP holds line', () => {
    expect(holdsLineKeep({ H: 30, J: 63, M: 123 })).toBe(
      'Reached the target within 30 years in 63 of the 123 full 30-year stretches since 1871 — a count of past stretches, not a probability.',
    );
    // H=1 plural variant:
    expect(holdsLineKeep({ H: 1, J: 40, M: 152 })).toBe(
      'Reached the target within 1 year in 40 of the 152 full 1-year stretches since 1871 — a count of past stretches, not a probability.',
    );
  });
  it('CH-2 STOP holds line names "without further contributions"', () => {
    expect(holdsLineStop({ H: 30, J: 63, M: 123 })).toBe(
      'Reached the target within 30 years without further contributions in 63 of the 123 full 30-year stretches since 1871 — a count of past stretches, not a probability.',
    );
  });
  it('CH-3 pointwise fan caption (one string, both cards)', () => {
    expect(fanCaption({ M: 143, H: 10 })).toBe(
      "At each year, the shaded band spans the middle half (25th–75th) of the balances the 143 full 10-year stretches in the bundled U.S. dataset (1871–2022) had reached by that year; the line is the per-year median, not any single stretch's path. 75% stocks / 25% bonds, rebalanced yearly, gross of fees · today's dollars, in both page views · history, not a forecast.",
    );
  });
  it('CH-4 compound cadence caption', () => {
    expect(COMPOUND_CADENCE_CAPTION).toBe(
      'History compounds annually at real (CPI-adjusted) historical returns — the frequency and variance knobs apply to the assumed view.',
    );
  });
  it('CH-5 too-few line + singular variant', () => {
    expect(tooFewStretchesLine({ M: 23, H: 130 })).toBe(
      'Only 23 full 130-year stretches exist in the 1871–2022 data — too few to draw a meaningful middle half.',
    );
    expect(tooFewStretchesLine({ M: 1, H: 152 })).toBe(
      'Only 1 full 152-year stretch exists in the 1871–2022 data — too few to draw a meaningful middle half.',
    );
  });
  it('CH-6 no-stretch line', () => {
    expect(noStretchLine({ H: 160 })).toBe('No full 160-year stretch exists in the 1871–2022 data.');
  });
  it('CH-7 control labels', () => {
    expect(RETURN_SOURCE_GROUP_LABEL).toBe('Return source');
    expect(RETURN_SOURCE_ASSUMED_LABEL).toBe('Assumed');
    expect(RETURN_SOURCE_HISTORY_LABEL).toBe('History');
  });
  it('CH-8 chart labels — built from W5’s landed today suffix, never retyped (CH-10)', () => {
    expect(HISTORY_CHART_LABEL_PATH_TO_FI).toBe("Path to FI — history (today's $)");
    expect(HISTORY_CHART_LABEL_COMPOUND).toBe("Balance over time — history (today's $)");
    // Referential, not merely equal: the pinned register IS W5's.
    expect(HISTORY_CHART_LABEL_PATH_TO_FI.endsWith(TODAY_SUFFIX)).toBe(true);
    expect(HISTORY_CHART_LABEL_COMPOUND.endsWith(TODAY_SUFFIX)).toBe(true);
    const src = readFileSync('src/lib/calculators/history-fan-copy.ts', 'utf8');
    expect(src).toContain('TODAY_SUFFIX');
    expect(src).not.toContain("(today's $)");
  });
  it('CH-9 legend labels (verbatim from the Backtest bands legend)', () => {
    expect(FAN_LEGEND_BAND).toBe('25th–75th percentile');
    expect(FAN_LEGEND_MEDIAN).toBe('Median (p50)');
  });
  it('forbidden-register guard: no probability-family words outside the sanctioned negation', () => {
    const src = readFileSync('src/lib/calculators/history-fan-copy.ts', 'utf8');
    expect(src).not.toMatch(/\b(chance|odds|confidence|success rate|worst case|best case|likely|safe)\b/i);
    // 'probability' may ONLY appear as the negation "not a probability":
    expect(src.replace(/not a probability/g, '')).not.toMatch(/probabilit/i);
    // No advice voice, no exclamation marks.
    expect(src).not.toMatch(/\b(you should|we recommend|it'?s best to)\b/i);
    expect(src).not.toContain('!');
  });
});
