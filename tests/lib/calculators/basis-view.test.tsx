import { describe, it, expect } from 'vitest';
import {
  TODAY_PHRASE,
  TODAY_SUFFIX,
  FUTURE_SUFFIX,
  futurePhrase,
  basisPhrase,
  basisSuffix,
  chartModeFor,
} from '@/lib/calculators/basis-view';

describe('basis vocabulary (D-T4 copy contract)', () => {
  it('long-register pair', () => {
    expect(TODAY_PHRASE).toBe("in today's dollars");
    expect(futurePhrase(0.03)).toBe('in future dollars, at your 3% inflation assumption');
    expect(futurePhrase(0.024)).toBe('in future dollars, at your 2.4% inflation assumption');
    // pctFromFraction kills IEEE754 artifacts AND trailing zeros:
    expect(futurePhrase(0.0275)).toBe('in future dollars, at your 2.75% inflation assumption');
    expect(futurePhrase(0.07 - 0.04)).toBe('in future dollars, at your 3% inflation assumption');
  });

  it('F11 zero-inflation edge phrase', () => {
    expect(futurePhrase(0)).toBe(
      "in future dollars — at your 0% inflation assumption these equal today's dollars",
    );
  });

  it('short-register pair + dispatch helpers', () => {
    expect(TODAY_SUFFIX).toBe("(today's $)");
    expect(FUTURE_SUFFIX).toBe('(future $)');
    expect(basisSuffix('today')).toBe(TODAY_SUFFIX);
    expect(basisPhrase('today', 0.03)).toBe(TODAY_PHRASE);
    expect(basisPhrase('future', 0.03)).toBe(futurePhrase(0.03));
  });

  it('D-T10: the boundary owns the ONE engine mapping (today→REAL, future→NOMINAL)', () => {
    expect(chartModeFor('today')).toBe('REAL');
    expect(chartModeFor('future')).toBe('NOMINAL');
  });
});
