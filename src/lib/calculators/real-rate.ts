/**
 * Convert a NOMINAL annual return rate into the REAL (inflation-adjusted) rate
 * via the Fisher equation:
 *
 *   (1 + r_real) = (1 + r_nominal) / (1 + inflation)
 *   r_real       = (1 + r_nominal) / (1 + inflation) − 1
 *
 * Why the FI / Coast-FI dashboard cards need this (H1):
 *
 * The FI target is `annualExpenses_today / SWR` — stated in TODAY'S dollars
 * (a REAL figure). But `household.growthScenarios` rates (e.g. 5/6/7/8%) are
 * NOMINAL — the projection engine treats them as nominal and deflates the
 * resulting balance via CPI (see `src/lib/scenarios/real.ts`). Solving an
 * FV/PV problem that grows a balance at a NOMINAL rate toward a REAL target
 * is a units mismatch:
 *   - Years-to-FI: a nominal balance reaches a real target too early →
 *     OPTIMISTIC (understates the years).
 *   - Coast-needed-today: discounting a real target by a nominal rate
 *     under-states the portfolio you need today to coast.
 *
 * Converting each scenario's rate to REAL before the solve fixes both: the
 * solve then grows/discounts a real balance against a real target, all in
 * today's purchasing power.
 *
 * The result is FLOORED at 0. A negative real rate (inflation exceeding the
 * nominal return) makes the Coast-FI framing nonsensical — we'd be telling the
 * user to save MORE than the FI target today to "coast" — so both the dashboard
 * cards and the What-If FiCards clamp it to 0 (coast = the full target; FI
 * years accumulate linearly at 0% real). This is the SINGLE shared real-rate
 * helper for both surfaces: identical floor ⇒ identical numbers for the same
 * household (N1 cross-card consistency). The realistic scenario rates (5–8%)
 * against typical inflation (~2.5–3%) are always comfortably positive, so the
 * clamp is an edge case, not the common path.
 *
 * @param nominalRate annual nominal return as a fraction (0.07 = 7%)
 * @param inflation   annual inflation as a fraction (0.025 = 2.5%)
 */
export function realRateOf(nominalRate: number, inflation: number): number {
  return Math.max(0, realRateOfUnfloored(nominalRate, inflation));
}

/**
 * The EXACT Fisher real rate with NO 0-floor — negative results are returned
 * as-is (inflation exceeding the nominal return ⇒ a negative real return).
 *
 * Which caller uses which, and WHY:
 *   - `financialIndependenceSeries`'s years-to-FI solve uses THIS (unfloored)
 *     rate, so the table agrees with the projection chart, which compounds the
 *     unfloored real rate (Wave 6 contribution-basis fix). A negative real rate
 *     makes the solve return Infinity — the scenario genuinely never reaches a
 *     real target in real terms, which the table renders as "—".
 *   - Coast-FI framing (`CoastFiCard`, What-If `FiCards`) keeps the FLOORED
 *     {@link realRateOf}: "coast needed today" degenerates to the full target
 *     at a 0 real rate, which is the meaningful edge answer there (telling a
 *     user to save MORE than the FI target to "coast" is nonsensical). Those
 *     surfaces show an explanatory note when the floor bites.
 */
export function realRateOfUnfloored(nominalRate: number, inflation: number): number {
  return (1 + nominalRate) / (1 + inflation) - 1;
}
