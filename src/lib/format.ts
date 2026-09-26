export const formatCurrency = (n: number): string =>
  // v1.7.1 M1: a negative reads "−$500" (U+2212), never Intl's "-$500".
  withTrueMinus(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n));

/** The TRUE MINUS (U+2212). The ASCII hyphen-minus is never a sign in rendered copy. */
export const TRUE_MINUS = '−';

/**
 * The leading-glyph rule, shared (v1.7.1 M1). Intl's en-US currency output and
 * Number#toFixed put a sign only in the FIRST character, and it is the ASCII
 * hyphen-minus; this swaps exactly that character for TRUE_MINUS. Every other
 * character is untouched, so no figure's digits, grouping or rounding move —
 * only the glyph. Post-processed rather than `signDisplay`, for the reason
 * formatPercent gives below (older WebViews throw on NumberFormat v3 options).
 */
export function withTrueMinus(s: string): string {
  return s.startsWith('-') ? TRUE_MINUS + s.slice(1) : s;
}

const PERCENT_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
});

/**
 * Percent from a fraction (0.029 → "2.9%"), at most one decimal. A negative
 * renders with a TRUE MINUS (U+2212, "−1%"): the money register
 * (formatSignedCurrency) and every hand-rolled signed percent in the app
 * (StressTestCard, PositionsSection, MonthlyMiniWindow, AssetValueChart)
 * already use it, while Intl's en-US percent output is the ASCII hyphen
 * (B3, v1.7.0). Post-processed rather than `signDisplay: 'negative'`, which
 * throws a RangeError on WebViews that predate NumberFormat v3. A value that
 * rounds to zero at this precision renders unsigned ("0%", never "-0%"): the
 * sign of a rounded-away magnitude is a formatting artifact, not a rate.
 */
export const formatPercent = (n: number): string => {
  const s = PERCENT_FORMATTER.format(n);
  if (s === '-0%') return '0%';
  return s.startsWith('-') ? TRUE_MINUS + s.slice(1) : s;
};

/**
 * Explicitly SIGNED percent from a fraction: '+' for zero and positives, the
 * TRUE MINUS for negatives, exactly `digits` decimals (0.1 → "+10.0%",
 * −0.034 → "−3.4%", −0.391 with 0 digits → "−39%"). The register of
 * StressTestCard's headline and "vs start" cells, shared (B3). The 1e-8
 * pre-round is pctFromFraction's (scenario-assumptions.ts), inlined so this
 * module stays a leaf — 0.0295 × 100 is 2.9499999999999997 in IEEE-754 and
 * must still read "3.0" (the percent the fraction stands for is 2.95). The
 * sign is decided on the RAW fraction, as signedPct does: a float-noise
 * negative (0.3 − (0.1 + 0.2)) pre-rounds to −0, and reading the sign there
 * would print "+0.0%" where the Stress card prints "−0.0%".
 */
export function formatSignedPercent(fraction: number, digits: number): string {
  const pct = Math.round(fraction * 100 * 1e8) / 1e8;
  return `${fraction < 0 ? TRUE_MINUS : '+'}${Math.abs(pct).toFixed(digits)}%`;
}

/**
 * Signed full-dollar form: a negative renders with a TRUE MINUS (U+2212,
 * "−$215"); a non-negative renders plain ("$215" — no plus sign). For Δ
 * cells that need an explicit +, callers prepend it.
 */
export const formatSignedCurrency = (v: number): string =>
  v < 0 ? '−' + formatCurrency(Math.abs(v)) : formatCurrency(v);

/**
 * Adaptive dollar formatter for chart axes. Scales suffix by magnitude:
 *   |v| < $1,000        -> "$500"
 *   $1k ≤ |v| < $1M     -> "$80k" / "$1.5k" (1 decimal only if non-whole)
 *   |v| >= $1M          -> "$1.2M" / "$5M"  (1 decimal only if non-whole)
 *
 * For tooltip and detail-row dollar values prefer `formatCurrency` from
 * the same module, which renders the full "$80,000" form (no cents).
 */
/**
 * House date convention (Wave 11): calendar-day ISO strings ('YYYY-MM-DD')
 * render as 'Jun 15, 2028'; year-months ('YYYY-MM') as 'Jul 2026'. Both
 * format in UTC because the inputs are calendar DAYS, not instants —
 * local-time formatting would shift the displayed day for users west of
 * UTC (the DebtPayoffCard/formatPaymentMonth precedent, now canonical).
 * Real instants (timestamps like backups/refreshes) do NOT use these;
 * they use toLocaleString(undefined, { dateStyle: 'medium', timeStyle:
 * 'short' }) at the call site.
 */
const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
export function formatDate(isoDay: string): string {
  return DATE_FORMATTER.format(new Date(`${isoDay}T00:00:00Z`));
}

const MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
export function formatMonth(isoMonth: string): string {
  return MONTH_FORMATTER.format(new Date(`${isoMonth.slice(0, 7)}-01T00:00:00Z`));
}

/**
 * Transaction-grain money: exact cents WITH thousands separators
 * ($6,846.84; a credit reads −$2,450.00 — v1.7.1 M1). formatCurrency (whole
 * dollars) stays the default for aggregates; this exists so no surface ever
 * hand-rolls `toFixed(2)`.
 */
const CENTS_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const formatCurrencyCents = (n: number): string => withTrueMinus(CENTS_FORMATTER.format(n));

export function formatCompactCurrency(v: number): string {
  // v1.7.1 M1: the sign leads the symbol and is the TRUE MINUS ("−$80k"; the
  // pre-M1 body put the sign after the symbol). The magnitude is formatted exactly as before —
  // Number#toFixed is sign-symmetric — so only the glyph and its position move.
  const sign = v < 0 ? TRUE_MINUS : '';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return sign + '$' + (Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1)) + 'M';
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    return sign + '$' + (Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)) + 'k';
  }
  return sign + '$' + abs.toFixed(0);
}
