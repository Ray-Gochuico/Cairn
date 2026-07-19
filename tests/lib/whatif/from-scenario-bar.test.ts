import { describe, it, expect } from 'vitest';
import { leverPayloadFromScenarioBar, type ScenarioBarSnapshot } from '@/lib/whatif/from-scenario-bar';
import { LeverPayloadSchema, emptyLeverPayload } from '@/lib/scenarios';

const TODAY = '2026-07-18';

const untouched: ScenarioBarSnapshot = {
  portfolio: null,
  realPortfolio: 200_000,
  monthlyContribution: null,
  monthlyExpenses: null,
  swr: null,
  inflation: null,
  salaryByPersonIndex: [null, null],
};

describe('leverPayloadFromScenarioBar (Wave 18 D6)', () => {
  it('an untouched bar maps to emptyLeverPayload() defaults (income normalized per person)', () => {
    const p = leverPayloadFromScenarioBar(untouched, TODAY);
    const empty = emptyLeverPayload();
    // Two persons in the snapshot → two no-op income plans; everything else
    // deep-equals the empty payload.
    expect(p.income.perPerson).toEqual([
      { annualRaiseRate: 0, events: [] },
      { annualRaiseRate: 0, events: [] },
    ]);
    expect({ ...p, income: empty.income }).toEqual(empty);
  });

  it('portfolio → a today-dated lump-sum DELTA into investments (signed; down edits work)', () => {
    const up = leverPayloadFromScenarioBar({ ...untouched, portfolio: 250_000 }, TODAY);
    expect(up.lumpSums).toEqual([
      {
        when: TODAY,
        amount: 50_000,
        destination: 'investments',
        label: 'Scenario bar: portfolio adjustment',
      },
    ]);
    const down = leverPayloadFromScenarioBar({ ...untouched, portfolio: 150_000 }, TODAY);
    expect(down.lumpSums[0].amount).toBe(-50_000);
    // Equal to the real prefill → no lump sum at all.
    const same = leverPayloadFromScenarioBar({ ...untouched, portfolio: 200_000 }, TODAY);
    expect(same.lumpSums).toEqual([]);
  });

  it('contribution → one open-ended ContributionSegment', () => {
    const p = leverPayloadFromScenarioBar({ ...untouched, monthlyContribution: 2_000 }, TODAY);
    expect(p.contributions).toEqual([
      {
        startMonth: 0,
        endMonth: null,
        monthlyAmount: 2_000,
        label: 'Scenario bar: contribution',
        allocation: null,
      },
    ]);
  });

  it('expenses → expenseSource custom + customMonthly', () => {
    const p = leverPayloadFromScenarioBar({ ...untouched, monthlyExpenses: 4_500 }, TODAY);
    expect(p.expenseSource).toBe('custom');
    expect(p.customMonthly).toBe(4_500);
  });

  it('SWR + inflation map with schema clamps', () => {
    const p = leverPayloadFromScenarioBar(
      { ...untouched, swr: 0.5, inflation: 0.9 },
      TODAY,
    );
    expect(p.swrOverride).toBe(0.15);
    expect(p.inflation.defaultRate).toBe(0.2);
    const low = leverPayloadFromScenarioBar(
      { ...untouched, swr: 0.0001, inflation: -0.5 },
      TODAY,
    );
    expect(low.swrOverride).toBe(0.005);
    expect(low.inflation.defaultRate).toBe(-0.05);
  });

  it('salary edits → per-person job_change events at today (untouched persons get no events)', () => {
    const p = leverPayloadFromScenarioBar(
      { ...untouched, salaryByPersonIndex: [120_000, null] },
      TODAY,
    );
    expect(p.income.perPerson).toEqual([
      {
        annualRaiseRate: 0,
        events: [
          { when: TODAY, type: 'job_change', newSalary: 120_000, label: 'Scenario bar: salary' },
        ],
      },
      { annualRaiseRate: 0, events: [] },
    ]);
  });

  it('all fields together parse clean through LeverPayloadSchema', () => {
    const p = leverPayloadFromScenarioBar(
      {
        portfolio: 300_000,
        realPortfolio: 200_000,
        monthlyContribution: 1_500,
        monthlyExpenses: 5_200,
        swr: 0.035,
        inflation: 0.03,
        salaryByPersonIndex: [110_000, 90_000],
      },
      TODAY,
    );
    expect(() => LeverPayloadSchema.parse(p)).not.toThrow();
    expect(p.lumpSums[0].amount).toBe(100_000);
    expect(p.contributions[0].monthlyAmount).toBe(1_500);
    expect(p.customMonthly).toBe(5_200);
    expect(p.swrOverride).toBe(0.035);
    expect(p.inflation.defaultRate).toBe(0.03);
    expect(p.income.perPerson).toHaveLength(2);
  });

  it('negative contribution/expenses clamp to 0 (never persist garbage)', () => {
    const p = leverPayloadFromScenarioBar(
      { ...untouched, monthlyContribution: -50, monthlyExpenses: -10 },
      TODAY,
    );
    expect(p.contributions[0].monthlyAmount).toBe(0);
    expect(p.customMonthly).toBe(0);
  });
});
