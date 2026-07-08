import { describe, it, expect } from 'vitest';
import {
  effectiveAnnualInflation,
  effectiveBaselineInflation,
  effectiveAnnualInflationFromSlice,
  captureInflationSlice,
} from '@/lib/scenarios/effective-inflation';
import type { AppSettings, Household } from '@/types/schema';
import type { Scenario } from '@/types/scenario';
import { FiPillsPosition, ProjectionDetailLevel, RefreshCadence } from '@/types/enums';
import { emptyLeverPayload, type InflationSchedule } from '@/lib/scenarios/lever-types';
import { makeHousehold as makeBaseHousehold } from '../../factories';

const makeHousehold = (inflationAssumption: number): Household =>
  makeBaseHousehold({ monthlyExpenseBaseline: 4500, inflationAssumption });

function makeSettings(defaultInflation: number | null): AppSettings {
  return {
    id: 1,
    sidebarLayout: null,
    notificationsEnabled: true,
    notificationDay: 1,
    refreshCadence: RefreshCadence.EVERY_LAUNCH,
    lastRefreshAt: null,
    statementsFolderPath: null,
    defaultInflation,
    defaultReturnRate: null,
    defaultFiPillsPosition: FiPillsPosition.ABOVE,
    defaultProjectionDetailLevel: ProjectionDetailLevel.TAX_BUCKET,
    defaultCashApy: null,
  } as AppSettings;
}

function makeScenario(inflation: InflationSchedule): Scenario {
  const payload = emptyLeverPayload();
  payload.inflation = inflation;
  return {
    id: 1,
    name: 'Test',
    isBaseline: false,
    color: '#000',
    lineStyle: 'solid',
    visible: true,
    isActive: true,
    sortOrder: 0,
    leverPayload: payload,
    createdAt: 't',
    updatedAt: 't',
  } as unknown as Scenario;
}

describe('effectiveBaselineInflation (precedence chain)', () => {
  it('uses scenario.defaultRate when set (overrides household)', () => {
    const scenario = makeScenario({ defaultRate: 0.05, overrides: {} });
    const result = effectiveBaselineInflation(scenario, makeHousehold(0.025), makeSettings(0.02));
    expect(result).toBeCloseTo(0.05, 6);
  });

  it('scenario.defaultRate = 0 wins (explicit zero override)', () => {
    const scenario = makeScenario({ defaultRate: 0, overrides: {} });
    const result = effectiveBaselineInflation(scenario, makeHousehold(0.025), makeSettings(0.02));
    expect(result).toBe(0);
  });

  it('falls through to household.inflationAssumption when scenario.defaultRate is null', () => {
    const scenario = makeScenario({ defaultRate: null, overrides: {} });
    const result = effectiveBaselineInflation(scenario, makeHousehold(0.025), makeSettings(0.02));
    expect(result).toBeCloseTo(0.025, 6);
  });

  it('falls through to settings.defaultInflation when household is null', () => {
    const scenario = makeScenario({ defaultRate: null, overrides: {} });
    const result = effectiveBaselineInflation(scenario, null, makeSettings(0.02));
    expect(result).toBeCloseTo(0.02, 6);
  });

  it('falls through to 0.03 hardcoded when nothing is set', () => {
    expect(effectiveBaselineInflation(null, null, null)).toBeCloseTo(0.03, 6);
  });

  it('null scenario uses household value when present', () => {
    expect(effectiveBaselineInflation(null, makeHousehold(0.04), null)).toBeCloseTo(0.04, 6);
  });

  it('scenario.inflation.overrides are NOT consulted by the baseline resolver', () => {
    // Baseline is the "headline" rate; year-overrides are ignored here.
    const scenario = makeScenario({ defaultRate: null, overrides: { '2030': 0.10 } });
    const result = effectiveBaselineInflation(scenario, makeHousehold(0.025), makeSettings(0.02));
    expect(result).toBeCloseTo(0.025, 6);
  });
});

describe('effectiveAnnualInflation (year-aware)', () => {
  it('per-year override wins over scenario.defaultRate', () => {
    const scenario = makeScenario({ defaultRate: 0.03, overrides: { '2030': 0.08 } });
    const result = effectiveAnnualInflation(scenario, makeHousehold(0.025), makeSettings(0.02), 2030);
    expect(result).toBeCloseTo(0.08, 6);
  });

  it('per-year override wins over household.inflationAssumption when no scenario.defaultRate', () => {
    const scenario = makeScenario({ defaultRate: null, overrides: { '2030': 0.08 } });
    const result = effectiveAnnualInflation(scenario, makeHousehold(0.025), makeSettings(0.02), 2030);
    expect(result).toBeCloseTo(0.08, 6);
  });

  it('uses scenario.defaultRate when the requested year is not in overrides', () => {
    const scenario = makeScenario({ defaultRate: 0.04, overrides: { '2030': 0.08 } });
    const result = effectiveAnnualInflation(scenario, makeHousehold(0.025), makeSettings(0.02), 2031);
    expect(result).toBeCloseTo(0.04, 6);
  });

  it('falls through to household when neither scenario nor override is set', () => {
    const scenario = makeScenario({ defaultRate: null, overrides: {} });
    const result = effectiveAnnualInflation(scenario, makeHousehold(0.025), makeSettings(0.02), 2030);
    expect(result).toBeCloseTo(0.025, 6);
  });

  it('falls through to settings when household and scenario are absent', () => {
    expect(effectiveAnnualInflation(null, null, makeSettings(0.018), 2027)).toBeCloseTo(0.018, 6);
  });

  it('falls through to 0.03 hardcoded when nothing is set', () => {
    expect(effectiveAnnualInflation(null, null, null, 2030)).toBeCloseTo(0.03, 6);
  });

  it('per-year override of 0 (explicit deflation flat year) is honoured', () => {
    const scenario = makeScenario({ defaultRate: 0.05, overrides: { '2030': 0 } });
    const result = effectiveAnnualInflation(scenario, makeHousehold(0.025), makeSettings(0.02), 2030);
    expect(result).toBe(0);
  });

  it('negative per-year override (deflation) is honoured', () => {
    const scenario = makeScenario({ defaultRate: 0.03, overrides: { '2030': -0.02 } });
    const result = effectiveAnnualInflation(scenario, makeHousehold(0.025), makeSettings(0.02), 2030);
    expect(result).toBeCloseTo(-0.02, 6);
  });
});

describe('captureInflationSlice + effectiveAnnualInflationFromSlice', () => {
  it('captures the precedence chain inputs from scenario/household/settings', () => {
    const scenario = makeScenario({ defaultRate: 0.04, overrides: { '2030': 0.08 } });
    const slice = captureInflationSlice(scenario, makeHousehold(0.025), makeSettings(0.02));
    expect(slice.scenarioDefault).toBe(0.04);
    expect(slice.scenarioOverrides).toEqual({ '2030': 0.08 });
    expect(slice.householdInflation).toBe(0.025);
    expect(slice.settingsInflation).toBe(0.02);
  });

  it('null scenario produces null defaults in slice', () => {
    const slice = captureInflationSlice(null, makeHousehold(0.025), makeSettings(0.02));
    expect(slice.scenarioDefault).toBeNull();
    expect(slice.scenarioOverrides).toEqual({});
    expect(slice.householdInflation).toBe(0.025);
    expect(slice.settingsInflation).toBe(0.02);
  });

  it('resolves year-aware inflation through the same precedence chain as the public resolver', () => {
    const scenario = makeScenario({ defaultRate: 0.04, overrides: { '2030': 0.08 } });
    const slice = captureInflationSlice(scenario, makeHousehold(0.025), makeSettings(0.02));
    expect(effectiveAnnualInflationFromSlice(slice, 2030)).toBeCloseTo(0.08, 6);
    expect(effectiveAnnualInflationFromSlice(slice, 2031)).toBeCloseTo(0.04, 6);
  });

  it('falls through every step when slice has only settings populated', () => {
    const slice = captureInflationSlice(null, null, makeSettings(0.018));
    expect(effectiveAnnualInflationFromSlice(slice, 2030)).toBeCloseTo(0.018, 6);
  });

  it('hardcoded fallback of 0.03 when slice is empty', () => {
    const slice = captureInflationSlice(null, null, null);
    expect(effectiveAnnualInflationFromSlice(slice, 2030)).toBeCloseTo(0.03, 6);
  });
});
