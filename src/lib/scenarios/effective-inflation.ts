import type { AppSettings, Household } from '@/types/schema';
import type { Scenario } from '@/types/scenario';

/**
 * Inflation precedence chain (pure, framework-free):
 *
 *   1. `scenario.leverPayload.inflation.overrides[year]` (per-year override)
 *   2. `scenario.leverPayload.inflation.defaultRate`    (per-scenario default)
 *   3. `household.inflationAssumption`                  (per-household setting)
 *   4. `settings.defaultInflation`                      (app-wide default)
 *   5. `0.03`                                            (hardcoded fallback)
 *
 * Mirrors the {@link effectiveCashApy} / {@link effectiveSwr} resolver
 * convention: pure function, receives slices as parameters, never reaches
 * into Zustand. The 0.03 hardcoded fallback matches the AdvancedSection
 * "Defaults to 2.5% inflation" UX surface within 0.5% — defensive against
 * cold-start with no household or settings.
 */

/**
 * Resolves the year-aware annual inflation rate for a scenario.
 *
 * The year-lookup step is the only difference from the baseline resolver
 * (see {@link effectiveBaselineInflation}). A year-override always wins
 * when present, regardless of how high in the chain the scenario default
 * sits.
 */
export function effectiveAnnualInflation(
  scenario: Scenario | null,
  household: Household | null,
  settings: AppSettings | null,
  year: number,
): number {
  // Step 1: per-year scenario override wins outright.
  const override = scenario?.leverPayload?.inflation?.overrides?.[String(year)];
  if (override != null) return override;

  // Steps 2-5: same as the baseline resolver.
  return effectiveBaselineInflation(scenario, household, settings);
}

/**
 * Resolves the "headline" annual inflation rate used for the nominal → real
 * display conversion. Used by {@link toReal} call sites where a single
 * deflator is applied to the whole projection; per-year overrides do not
 * apply here in v1.
 *
 * TODO(task15/v2): the display path could compute per-year deflators when
 * the inflation overrides map is non-empty. See spec §6 — picked option (a)
 * for v1 to keep the diff minimal.
 */
export function effectiveBaselineInflation(
  scenario: Scenario | null,
  household: Household | null,
  settings: AppSettings | null,
): number {
  // 2. Per-scenario default.
  const scenarioDefault = scenario?.leverPayload?.inflation?.defaultRate;
  if (scenarioDefault != null) return scenarioDefault;

  // 3. Household default.
  if (household?.inflationAssumption != null) return household.inflationAssumption;

  // 4. App settings default.
  if (settings?.defaultInflation != null) return settings.defaultInflation;

  // 5. Hardcoded fallback.
  return 0.03;
}

/**
 * Frozen-at-start slice used by the engine. Pre-computes the precedence
 * chain values once at projection start so {@link effectiveAnnualInflationFromSlice}
 * can do a year-lookup per step without re-reading the household / settings
 * surfaces.
 *
 * Mirrors the engine slice pattern (conventions.md §"Engine slice pattern").
 */
export interface InflationSlice {
  /** scenario.leverPayload.inflation.defaultRate */
  scenarioDefault: number | null;
  /** scenario.leverPayload.inflation.overrides — per-year keyed by 4-digit year. */
  scenarioOverrides: Record<string, number>;
  /** household.inflationAssumption */
  householdInflation: number | null;
  /** settings.defaultInflation */
  settingsInflation: number | null;
}

/**
 * Captures the per-step inputs the engine needs. The scenario / household /
 * settings are read once at projection start; the engine then calls
 * {@link effectiveAnnualInflationFromSlice} with a year per step.
 */
export function captureInflationSlice(
  scenario: Scenario | null,
  household: Household | null,
  settings: AppSettings | null,
): InflationSlice {
  return {
    scenarioDefault: scenario?.leverPayload?.inflation?.defaultRate ?? null,
    scenarioOverrides: scenario?.leverPayload?.inflation?.overrides ?? {},
    householdInflation: household?.inflationAssumption ?? null,
    settingsInflation: settings?.defaultInflation ?? null,
  };
}

/**
 * Year-aware resolver against the captured slice. Same precedence as
 * {@link effectiveAnnualInflation} but operates on a pre-captured slice
 * so the engine doesn't re-read Zustand stores in its hot loop.
 */
export function effectiveAnnualInflationFromSlice(slice: InflationSlice, year: number): number {
  const override = slice.scenarioOverrides[String(year)];
  if (override != null) return override;
  if (slice.scenarioDefault != null) return slice.scenarioDefault;
  if (slice.householdInflation != null) return slice.householdInflation;
  if (slice.settingsInflation != null) return slice.settingsInflation;
  return 0.03;
}
