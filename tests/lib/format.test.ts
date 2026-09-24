import { describe, it, expect } from 'vitest';
import {
  formatCompactCurrency,
  formatSignedCurrency,
  formatPercent,
  formatSignedPercent,
  formatDate,
  formatMonth,
  formatCurrencyCents,
} from '@/lib/format';
import { pctFromFraction } from '@/lib/calculators/scenario-assumptions';

describe('formatDate', () => {
  it('renders a calendar-day ISO string as Mon D, YYYY', () => {
    expect(formatDate('2028-06-15')).toBe('Jun 15, 2028');
  });
  it('is UTC-stable: the displayed day never shifts for west-of-UTC locales', () => {
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatDate('2026-12-31')).toBe('Dec 31, 2026');
  });
});

describe('formatMonth', () => {
  it('renders YYYY-MM as Mon YYYY', () => {
    expect(formatMonth('2026-07')).toBe('Jul 2026');
  });
  it('accepts a full ISO day and formats its month', () => {
    expect(formatMonth('2027-01-15')).toBe('Jan 2027');
  });
});

describe('formatCurrencyCents', () => {
  it('renders exact cents with thousands separators', () => {
    expect(formatCurrencyCents(6846.84)).toBe('$6,846.84');
  });
  it('renders negatives with a leading minus and separators', () => {
    expect(formatCurrencyCents(-2450)).toBe('-$2,450.00');
  });
  it('pads whole dollars to two decimals', () => {
    expect(formatCurrencyCents(40)).toBe('$40.00');
  });
});

describe('formatSignedCurrency', () => {
  it('renders negatives with a true minus (U+2212), full dollar form', () => {
    expect(formatSignedCurrency(-215)).toBe('−$215');
    expect(formatSignedCurrency(-180000)).toBe('−$180,000');
    expect(formatSignedCurrency(-1).charCodeAt(0)).toBe(0x2212); // U+2212, not ASCII hyphen
  });
  it('renders non-negatives plain — no plus sign', () => {
    expect(formatSignedCurrency(0)).toBe('$0');
    expect(formatSignedCurrency(215)).toBe('$215');
    expect(formatSignedCurrency(170000)).toBe('$170,000');
  });
});

describe('formatCompactCurrency', () => {
  it('formats sub-thousand values with no suffix', () => {
    expect(formatCompactCurrency(0)).toBe('$0');
    expect(formatCompactCurrency(500)).toBe('$500');
    expect(formatCompactCurrency(999)).toBe('$999');
  });
  it('formats thousands with k suffix, no decimal when whole', () => {
    expect(formatCompactCurrency(1000)).toBe('$1k');
    expect(formatCompactCurrency(80000)).toBe('$80k');
    expect(formatCompactCurrency(999000)).toBe('$999k');
  });
  it('formats thousands with k suffix + 1 decimal when not whole', () => {
    expect(formatCompactCurrency(1500)).toBe('$1.5k');
    expect(formatCompactCurrency(12300)).toBe('$12.3k');
  });
  it('formats millions with M suffix, no decimal when whole', () => {
    expect(formatCompactCurrency(1000000)).toBe('$1M');
    expect(formatCompactCurrency(5000000)).toBe('$5M');
  });
  it('formats millions with M suffix + 1 decimal when not whole', () => {
    expect(formatCompactCurrency(1200000)).toBe('$1.2M');
    expect(formatCompactCurrency(5500000)).toBe('$5.5M');
  });
  it('preserves sign for negative values', () => {
    expect(formatCompactCurrency(-500)).toBe('$-500');
    expect(formatCompactCurrency(-80000)).toBe('$-80k');
    expect(formatCompactCurrency(-1200000)).toBe('$-1.2M');
  });
});

/* B3 (v1.7.0, chip task_c681224b item 1): a negative PERCENT renders a TRUE
   MINUS app-wide. Intl's en-US percent output is the ASCII hyphen (U+002D);
   the money register (formatSignedCurrency) and every hand-rolled signed
   percent on the calculators/investments (StressTestCard.signedPct,
   PositionsSection.signedPctParen, MonthlyMiniWindow, AssetValueChart) are
   U+2212. Derivations: Appendix D.1 of the B3 plan. */
describe('formatPercent (B3 — a true minus for percentages)', () => {
  it('non-negatives are byte-identical to the landed output (at most one decimal, unsigned)', () => {
    expect(formatPercent(0.06)).toBe('6%');
    expect(formatPercent(0.029126213592232997)).toBe('2.9%'); // (1.06 / 1.03) − 1, the house fixture's Moderate real rate
    expect(formatPercent(0.04)).toBe('4%');
    expect(formatPercent(0.035)).toBe('3.5%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(1)).toBe('100%');
  });

  it('a negative renders with U+2212, never the ASCII hyphen', () => {
    // realRateOfUnfloored(0.02, 0.03) = 1.02 / 1.03 − 1 = −0.0097087… → "−1%" (CR-B3-1c's rate)
    expect(formatPercent(-0.009708737864077666)).toBe('−1%');
    expect(formatPercent(-0.0352)).toBe('−3.5%');
    expect(formatPercent(-1)).toBe('−100%');
    expect(formatPercent(-0.01).charCodeAt(0)).toBe(0x2212);
    expect(formatPercent(-0.01)).not.toContain('-');
  });

  it('a negative that rounds to zero at one decimal renders "0%" — never "-0%" or "−0%" (D-B3-2)', () => {
    // A 2.96% return at 3% inflation: real −0.000388… ; |x| < 0.0005 rounds to zero at one decimal.
    expect(formatPercent(-0.00038834951456301336)).toBe('0%');
    expect(formatPercent(-0.0004)).toBe('0%');
    expect(formatPercent(-0.00049)).toBe('0%');
    // Half a tenth of a percent is NOT zero under Intl's halfExpand rounding.
    expect(formatPercent(-0.0005)).toBe('−0.1%');
  });
});

describe('formatSignedPercent (B3 — the StressTestCard signedPct register, shared)', () => {
  it('explicit + for zero and positives, U+2212 for negatives, fixed decimals', () => {
    expect(formatSignedPercent(0.1, 1)).toBe('+10.0%');
    expect(formatSignedPercent(-0.034, 1)).toBe('−3.4%');
    expect(formatSignedPercent(-0.391, 0)).toBe('−39%');   // the Stress dot-com headline depth
    expect(formatSignedPercent(-0.391, 1)).toBe('−39.1%'); // CP-10's "vs start" cell
    expect(formatSignedPercent(0, 1)).toBe('+0.0%');
    expect(formatSignedPercent(-0.0004, 1)).toBe('−0.0%'); // the signed register keeps its sign at zero magnitude (Stress parity)
    expect(formatSignedPercent(-0.034, 1).charCodeAt(0)).toBe(0x2212);
    expect(formatSignedPercent(-0.034, 1)).not.toContain('-');
  });

  it('pre-rounds the percent to 1e-8 before toFixed (pctFromFraction parity — the card arithmetic, byte-for-byte)', () => {
    // 0.07 * 100 is 7.000000000000001 in IEEE-754 (toFixed(1) reads "7.0" either way).
    expect(formatSignedPercent(0.07, 1)).toBe('+7.0%');
    expect(formatSignedPercent(-0.0345, 1)).toBe('−3.5%');
    expect(formatSignedPercent(0.1005, 1)).toBe('+10.1%');
    // The load-bearing pair (a mutant without the pre-round reds HERE, not above):
    // 0.0295 * 100 is 2.9499999999999997 → toFixed(1) "2.9" raw; pre-rounded to the double
    // 2.95 (= 2.95000000000000017…) → "3.0". 0.0055 * 100 is 0.5499999999999999 → "0.5" raw;
    // pre-rounded 0.55 (= 0.55000000000000004…) → "0.6". StressTestCard.signedPct agrees
    // (Math.abs(pctFromFraction(f)).toFixed(d) — the same 1e-8 round).
    expect(formatSignedPercent(-0.0295, 1)).toBe('−3.0%');
    expect(formatSignedPercent(0.0055, 1)).toBe('+0.6%');
  });

  it('decides the sign on the RAW fraction, as StressTestCard.signedPct does — a float-noise negative reads "−0.0%", not "+0.0%" (B3 review)', () => {
    // StressTestCard.tsx signedPct, reproduced as the parity oracle:
    //   `${fraction < 0 ? '−' : '+'}${Math.abs(pctFromFraction(fraction)).toFixed(digits)}%`
    const signedPct = (fraction: number, digits: number): string =>
      `${fraction < 0 ? '−' : '+'}${Math.abs(pctFromFraction(fraction)).toFixed(digits)}%`;
    // 0.3 − (0.1 + 0.2) is −5.551115123125783e-17 (DriftCard's actualPct − targetPct lands in
    // this window): its 1e-8 pre-round is −0, and `-0 < 0` is false — a sign read off the
    // pre-rounded value printed "+0.0%".
    const noise = 0.3 - (0.1 + 0.2);
    expect(noise).toBeLessThan(0);
    expect(formatSignedPercent(noise, 1)).toBe('−0.0%');
    expect(formatSignedPercent(noise, 1)).toBe(signedPct(noise, 1));
    expect(formatSignedPercent(-1e-11, 0)).toBe('−0%');
    expect(formatSignedPercent(0.1 + 0.2 - 0.3, 1)).toBe('+0.0%');
    expect(formatSignedPercent(-0, 1)).toBe('+0.0%'); // −0 is not < 0: the zero register's "+"
    // Byte-for-byte over a sweep (0 and 1 digits) including the (−5e-11, 0) window.
    const fractions = [noise, -1e-11, -4.9e-11, -1e-17, 1e-17, -0, 0, Number.MIN_VALUE, -Number.MIN_VALUE];
    for (let i = -3000; i <= 3000; i++) fractions.push(i / 100_000);
    for (const f of fractions) {
      for (const d of [0, 1]) expect(formatSignedPercent(f, d)).toBe(signedPct(f, d));
    }
  });
});
