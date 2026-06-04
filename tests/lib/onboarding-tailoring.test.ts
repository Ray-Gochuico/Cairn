import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  computeTailoring,
  hasAnyHideRecommendation,
  type TailoringInput,
  type TailoringResult,
} from '@/lib/onboarding-tailoring';
import {
  makePerson,
  makeLoan,
  makeProperty,
  makeVehicle,
  makeEquityGrant,
} from '../factories';

const TODAY = new Date('2026-06-03');

function emptyInput(overrides: Partial<TailoringInput> = {}): TailoringInput {
  return {
    persons: [],
    accounts: [],
    holdings: [],
    properties: [],
    vehicles: [],
    equityGrants: [],
    loans: [],
    today: TODAY,
    ...overrides,
  };
}

function tab(result: TailoringResult, to: string) {
  const t = result.tabs.find((x) => x.to === to);
  if (!t) throw new Error(`tab ${to} not in result`);
  return t;
}

function calc(result: TailoringResult, id: string) {
  const c = result.calculators.find((x) => x.id === id);
  if (!c) throw new Error(`calc ${id} not in result`);
  return c;
}

describe('computeTailoring', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TODAY);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('empty input → every tab and every calculator is visible', () => {
    const r = computeTailoring(emptyInput());
    expect(r.tabs.every((t) => t.visible)).toBe(true);
    expect(r.calculators.every((c) => c.visible)).toBe(true);
  });

  it('the 8 always-shown calculators are visible even on empty input', () => {
    const r = computeTailoring(emptyInput());
    const always = [
      'paycheck',
      'financial-independence',
      'coast-fi',
      'compound-interest',
      'contribution-allocator',
      'backtest',
      'retirement-401k-withdrawal',
      'debt-payoff',
    ];
    for (const id of always) expect(calc(r, id).visible).toBe(true);
  });

  it('debt-payoff and retirement-401k-withdrawal are always shown (no age / no-loan gate)', () => {
    const r = computeTailoring(emptyInput({ persons: [makePerson()] }));
    expect(calc(r, 'debt-payoff').visible).toBe(true);
    expect(calc(r, 'retirement-401k-withdrawal').visible).toBe(true);
  });

  it('no properties / vehicles / equity-grants / loans → those tabs are hidden', () => {
    const r = computeTailoring(emptyInput({ persons: [makePerson()] }));
    expect(tab(r, '/property').visible).toBe(false);
    expect(tab(r, '/vehicles').visible).toBe(false);
    expect(tab(r, '/equity-grants').visible).toBe(false);
    expect(tab(r, '/loans').visible).toBe(false);
  });

  it('no loans hides the /loans tab but debt-payoff calc stays shown', () => {
    const r = computeTailoring(emptyInput({ persons: [makePerson()] }));
    expect(tab(r, '/loans').visible).toBe(false);
    expect(calc(r, 'debt-payoff').visible).toBe(true);
  });

  it('a loan reveals the /loans tab', () => {
    const r = computeTailoring(emptyInput({ loans: [makeLoan()] }));
    expect(tab(r, '/loans').visible).toBe(true);
  });

  it('a property reveals /property; a vehicle reveals /vehicles; a grant reveals /equity-grants', () => {
    const r = computeTailoring(
      emptyInput({
        properties: [makeProperty()],
        vehicles: [makeVehicle()],
        equityGrants: [makeEquityGrant()],
      }),
    );
    expect(tab(r, '/property').visible).toBe(true);
    expect(tab(r, '/vehicles').visible).toBe(true);
    expect(tab(r, '/equity-grants').visible).toBe(true);
  });

  it('commission 0 and bonus 0 → commission-tax and bonus-tax hidden', () => {
    const r = computeTailoring(
      emptyInput({ persons: [makePerson({ expectedBonus: 0, expectedCommission: 0 })] }),
    );
    expect(calc(r, 'commission-tax').visible).toBe(false);
    expect(calc(r, 'bonus-tax').visible).toBe(false);
  });

  it('expectedBonus > 0 reveals bonus-tax; expectedCommission > 0 reveals commission-tax', () => {
    const rb = computeTailoring(emptyInput({ persons: [makePerson({ expectedBonus: 5000 })] }));
    expect(calc(rb, 'bonus-tax').visible).toBe(true);
    const rc = computeTailoring(emptyInput({ persons: [makePerson({ expectedCommission: 5000 })] }));
    expect(calc(rc, 'commission-tax').visible).toBe(true);
  });

  it('a grant reveals the equity calculator', () => {
    const r = computeTailoring(emptyInput({ equityGrants: [makeEquityGrant()] }));
    expect(calc(r, 'equity').visible).toBe(true);
  });

  it('overtime matches the HOURLY / SALARY_WITH_OT set (CalculatorsLayout.showOvertime parity)', () => {
    const hourly = computeTailoring(
      emptyInput({ persons: [makePerson({ employmentType: 'HOURLY', hourlyRate: 25 })] }),
    );
    expect(calc(hourly, 'overtime').visible).toBe(true);

    const salaryOt = computeTailoring(
      emptyInput({ persons: [makePerson({ employmentType: 'SALARY_WITH_OT' })] }),
    );
    expect(calc(salaryOt, 'overtime').visible).toBe(true);

    const salaryNoOt = computeTailoring(
      emptyInput({ persons: [makePerson({ employmentType: 'SALARY_NO_OT' })] }),
    );
    expect(calc(salaryNoOt, 'overtime').visible).toBe(false);
  });

  it('two-person mixed → any-person OR reveals each matched conditional', () => {
    const r = computeTailoring(
      emptyInput({
        persons: [
          makePerson({ expectedBonus: 1000, expectedCommission: 0, employmentType: 'SALARY_NO_OT' }),
          makePerson({ expectedBonus: 0, expectedCommission: 2000, employmentType: 'HOURLY', hourlyRate: 30 }),
        ],
      }),
    );
    expect(calc(r, 'bonus-tax').visible).toBe(true);
    expect(calc(r, 'commission-tax').visible).toBe(true);
    expect(calc(r, 'overtime').visible).toBe(true);
  });

  it('persons exist but all conditionals zero → all 4 conditionals hidden, 8 always-shown still visible', () => {
    const r = computeTailoring(
      emptyInput({
        persons: [
          makePerson({ expectedBonus: 0, expectedCommission: 0, employmentType: 'SALARY_NO_OT' }),
        ],
      }),
    );
    for (const id of ['bonus-tax', 'commission-tax', 'overtime', 'equity']) {
      expect(calc(r, id).visible).toBe(false);
    }
    expect(calc(r, 'debt-payoff').visible).toBe(true);
    expect(calc(r, 'retirement-401k-withdrawal').visible).toBe(true);
  });

  it('every visible row carries a non-empty reason string', () => {
    const r = computeTailoring(emptyInput({ persons: [makePerson()] }));
    for (const t of r.tabs) expect(t.reason.length).toBeGreaterThan(0);
    for (const c of r.calculators) expect(c.reason.length).toBeGreaterThan(0);
  });
});

describe('hasAnyHideRecommendation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TODAY);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is false on truly empty input (fail-open: no persons → nothing to hide)', () => {
    // With no persons and no entities the engine cannot tailor anything —
    // every entry is visible (fail-open). hasAnyHideRecommendation is therefore
    // false, and the OnboardingController will skip the Tailor step when the
    // household has no data (correct UX: nothing to prune yet).
    expect(hasAnyHideRecommendation(computeTailoring(emptyInput()))).toBe(false);
  });

  it('is false when fully populated with nothing to hide', () => {
    // One person hitting every conditional, plus one of each entity, so no
    // tab and no calculator is recommended hidden.
    const r = computeTailoring(
      emptyInput({
        persons: [
          makePerson({
            expectedBonus: 1000,
            expectedCommission: 1000,
            employmentType: 'HOURLY',
            hourlyRate: 25,
          }),
        ],
        properties: [makeProperty()],
        vehicles: [makeVehicle()],
        equityGrants: [makeEquityGrant()],
        loans: [makeLoan()],
      }),
    );
    // Sanity: the constructed result truly has nothing hidden.
    expect(r.tabs.every((t) => t.visible)).toBe(true);
    expect(r.calculators.every((c) => c.visible)).toBe(true);
    expect(hasAnyHideRecommendation(r)).toBe(false);
  });
});
