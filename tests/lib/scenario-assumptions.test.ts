import { describe, it, expect, beforeEach } from 'vitest';
import {
  SCENARIO_STORAGE_KEY,
  SCENARIO_FIELDS,
  buildScenarioDefaults,
  toEngineAssumptions,
  pctFromFraction,
  readSharedOverrides,
  writeSharedOverrides,
  scenarioStorageKeyFor,
  readOverridesFor,
  writeOverridesFor,
  type ScenarioAssumptions,
} from '@/lib/calculators/scenario-assumptions';
import { effectiveSwr } from '@/lib/scenarios/effective-swr';
import { effectiveBaselineInflation } from '@/lib/scenarios/effective-inflation';
import { buildProjectionChartData } from '@/lib/calculators/projection-chart';
import { yearsToFi } from '@/lib/financial-independence';
import { realRateOf } from '@/lib/calculators/real-rate';
import { FilingStatus, AccountType } from '@/types/enums';
import type { Account, AppSettings, Household } from '@/types/schema';

beforeEach(() => sessionStorage.clear());

// ── Fixtures (mirror tests/components/FinancialIndependenceCard.test.tsx) ──
const TODAY = '2026-05-14';

function mkHousehold(overrides: Partial<Household> = {}): Household {
  return {
    filingStatus: FilingStatus.SINGLE,
    state: 'CA',
    city: null,
    monthlyExpenseBaseline: 5000,
    withdrawalRate: 0.04,
    inflationAssumption: 0.03,
    growthScenarios: [
      { label: 'Conservative', rate: 0.05 },
      { label: 'Moderate', rate: 0.06 },
      { label: 'Optimistic', rate: 0.07 },
    ],
    ...overrides,
  } as Household;
}

function mkAccount(id: number, type: AccountType = AccountType.ACCOUNT_BROKERAGE, excluded = false): Account {
  return {
    id, householdId: 1, ownerPersonId: null, beneficiaryDependentId: null,
    name: `Acct ${id}`, institution: null, type, cryptoWalletAddress: null,
    autoFetchEnabled: false, excludedFromNetWorth: excluded, stateOfPlan: null,
    accentColor: null,
  } as unknown as Account;
}

const EMPTY_INPUT = {
  household: null,
  settings: null,
  accounts: [] as Account[],
  snapshots: [] as Array<{ accountId: number; snapshotDate: string; totalValue: number }>,
  contributions: [] as Array<{ accountId: number; date: string; amount: number }>,
  todayIso: TODAY,
};

describe('buildScenarioDefaults', () => {
  it('empty stores → honest zero/canonical-fallback defaults with fallback provenance', () => {
    const { defaults, provenance } = buildScenarioDefaults(EMPTY_INPUT);
    expect(defaults).toEqual({
      portfolio: 0, annualContribution: 0, monthlyExpenses: 0,
      returnPct: 6, swrPct: 4, inflationPct: 3,
    });
    expect(provenance.portfolio).toBe('no account snapshots yet');
    expect(provenance.annualContribution).toBe('no contributions in the last 12 months');
    expect(provenance.monthlyExpenses).toBe('not set in Inputs');
    expect(provenance.returnPct).toBe('app default 6%');
    expect(provenance.swrPct).toBe('app default 4%');
    expect(provenance.inflationPct).toBe('app default 3%');
  });

  it('primed stores → canonical-resolver prefills with named provenance', () => {
    const { defaults, provenance } = buildScenarioDefaults({
      ...EMPTY_INPUT,
      household: mkHousehold({ withdrawalRate: 0.035, inflationAssumption: 0.028 }),
      accounts: [mkAccount(1), mkAccount(2, AccountType.ACCOUNT_529), mkAccount(3, AccountType.ACCOUNT_BROKERAGE, true)],
      snapshots: [
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 500_000 },
        { accountId: 2, snapshotDate: '2026-04-01', totalValue: 50_000 },  // 529 — excluded
        { accountId: 3, snapshotDate: '2026-04-01', totalValue: 25_000 },  // excludedFromNetWorth
      ],
      contributions: [
        { accountId: 1, date: '2026-01-15', amount: 10_000 }, // in window
        { accountId: 1, date: '2025-06-01', amount: 5_000 },  // in window (>= 2025-05-14)
        { accountId: 1, date: '2024-01-01', amount: 99_000 }, // OUT of the 12-month window
      ],
    });
    expect(defaults.portfolio).toBe(500_000);          // FI-eligible only
    expect(defaults.annualContribution).toBe(15_000);  // rolling 12 months
    expect(defaults.monthlyExpenses).toBe(5000);
    expect(defaults.returnPct).toBe(6);                // Moderate 0.06
    expect(defaults.swrPct).toBe(3.5);                 // household.withdrawalRate 0.035
    expect(defaults.inflationPct).toBe(2.8);           // household.inflationAssumption 0.028
    expect(provenance.portfolio).toBe('from your account snapshots');
    expect(provenance.annualContribution).toBe('your last 12 months of contributions');
    expect(provenance.monthlyExpenses).toBe('your monthly expense baseline');
    expect(provenance.returnPct).toBe('your Moderate growth scenario');
    expect(provenance.swrPct).toBe('your household setting');
    expect(provenance.inflationPct).toBe('your household setting');
  });

  it('a partial household without growthScenarios falls back to the 6% default (never crashes)', () => {
    const { defaults, provenance } = buildScenarioDefaults({
      ...EMPTY_INPUT,
      household: { filingStatus: FilingStatus.SINGLE, state: 'CA' } as unknown as Household,
    });
    expect(defaults.returnPct).toBe(6);
    expect(provenance.returnPct).toBe('app default 6%');
  });

  it('settings-level inflation gets Settings provenance', () => {
    const { defaults, provenance } = buildScenarioDefaults({
      ...EMPTY_INPUT,
      household: mkHousehold({ inflationAssumption: null as unknown as number }),
      settings: { defaultInflation: 0.025 } as AppSettings,
    });
    expect(defaults.inflationPct).toBe(2.5);
    expect(provenance.inflationPct).toBe('your Settings default');
  });

  // D8: the provenance wrapper can never drift from the canonical resolvers.
  it('PARITY: swrPct/inflationPct always equal the canonical resolvers, every chain branch', () => {
    const cases: Array<{ household: Household | null; settings: AppSettings | null }> = [
      { household: null, settings: null },
      { household: mkHousehold({ withdrawalRate: 0 }), settings: null },            // zero → 4% fallback
      { household: mkHousehold({ withdrawalRate: 0.033 }), settings: null },
      { household: mkHousehold({ inflationAssumption: null as unknown as number }), settings: { defaultInflation: 0.025 } as AppSettings },
      { household: null, settings: { defaultInflation: 0.02 } as AppSettings },
    ];
    for (const c of cases) {
      const { defaults } = buildScenarioDefaults({ ...EMPTY_INPUT, ...c });
      expect(defaults.swrPct / 100).toBeCloseTo(effectiveSwr(null, c.household), 10);
      expect(defaults.inflationPct / 100).toBeCloseTo(
        effectiveBaselineInflation(null, c.household, c.settings), 10,
      );
    }
  });
});

describe('toEngineAssumptions — THE percent/fraction boundary', () => {
  it('converts every field exactly once', () => {
    const eng = toEngineAssumptions({
      portfolio: 500_000, annualContribution: 24_000, monthlyExpenses: 5_000,
      returnPct: 6, swrPct: 4, inflationPct: 3,
    });
    expect(eng).toEqual({
      portfolio: 500_000,
      annualContribution: 24_000,
      monthlyContribution: 2_000,
      monthlyExpenses: 5_000,
      annualExpenses: 60_000,
      returnRate: 0.06,
      swr: 0.04,
      inflation: 0.03,
    });
  });

  it('pctFromFraction round-trips without float artifacts (0.07 → 7, not 7.000000000000001)', () => {
    expect(pctFromFraction(0.07)).toBe(7);
    expect(pctFromFraction(0.035)).toBe(3.5);
    expect(pctFromFraction(0.04)).toBe(4);
  });

  // HISTORICAL-ANCHOR (repo rule for the nominal-on-real bug class): pin a full
  // scenario THROUGH the conversion boundary and assert the downstream solve +
  // chart crossing land on the known year. If a future edit converts twice
  // (÷100 again) or not at all, the crossing moves by DECADES, not epsilon.
  // pv $500k, expenses $4,000/mo, SWR 4.8% → target 48,000/0.048 = $1,000,000
  // (today's dollars); 7% nominal, 3% inflation → real ≈ 3.8835%/yr →
  // yearsToFi ≈ 18.19 → first integer-year chart crossing = 19 (the same
  // anchor tests/lib/projection-chart.test.ts pins from the fraction side).
  it('HISTORICAL-ANCHOR: bar values through the boundary reproduce the year-19 crossing', () => {
    const values: ScenarioAssumptions = {
      portfolio: 500_000, annualContribution: 0, monthlyExpenses: 4_000,
      returnPct: 7, swrPct: 4.8, inflationPct: 3,
    };
    const eng = toEngineAssumptions(values);
    expect(eng.swr).toBeCloseTo(0.048, 12);
    expect(eng.inflation).toBeCloseTo(0.03, 12);
    const targetFv = eng.annualExpenses / eng.swr;
    expect(targetFv).toBeCloseTo(1_000_000, 4);

    const solve = yearsToFi({
      pv: eng.portfolio, pmt: eng.annualContribution,
      annualRate: realRateOf(eng.returnRate, eng.inflation), targetFv,
    });
    expect(Math.ceil(solve)).toBe(19);

    const rows = buildProjectionChartData({
      pv: eng.portfolio, annualContribution: eng.annualContribution, targetFv,
      scenarios: [{ label: 'Moderate', rate: eng.returnRate }],
      inflation: eng.inflation, displayMode: 'NOMINAL', horizon: 30,
    });
    const crossing = rows.find((r) => r.Moderate >= r.target)?.year ?? null;
    expect(crossing).toBe(19);
  });
});

describe('shared overrides persistence', () => {
  it('write → read round-trips; empty overrides remove the key', () => {
    writeSharedOverrides({ portfolio: 750_000, swrPct: 3.5 });
    expect(readSharedOverrides()).toEqual({ portfolio: 750_000, swrPct: 3.5 });
    writeSharedOverrides({});
    expect(sessionStorage.getItem(SCENARIO_STORAGE_KEY)).toBeNull();
  });

  it('corrupt JSON → {} (never throws)', () => {
    sessionStorage.setItem(SCENARIO_STORAGE_KEY, 'not-json');
    expect(readSharedOverrides()).toEqual({});
  });

  it('sanitizes: unknown fields and non-finite numbers are dropped on read', () => {
    sessionStorage.setItem(
      SCENARIO_STORAGE_KEY,
      JSON.stringify({ portfolio: 1, bogus: 2, swrPct: 'four', inflationPct: null, returnPct: Infinity }),
    );
    expect(readSharedOverrides()).toEqual({ portfolio: 1 });
  });
});

describe('one-shot legacy-silo migration (D7)', () => {
  it('maps + unit-converts all three silos, FI winning per-field conflicts', () => {
    sessionStorage.setItem('calc-state:financial-independence', JSON.stringify({
      currentPortfolio: 600_000, annualContribution: 30_000,
      monthlyExpenses: 4_500, withdrawalRatePct: 3.8,
    }));
    sessionStorage.setItem('calc-state:coast-fi', JSON.stringify({
      currentPortfolio: 111_111,        // loses to FI
      annualExpenses: 66_000,           // would map to 5_500 — loses to FI's 4_500
      withdrawalRate: 0.035,            // would map to 3.5 — loses to FI's 3.8
      yearsUntilRetirement: 15,         // LOCAL — must survive in place
    }));
    sessionStorage.setItem('calc-state:compound-interest', JSON.stringify({
      pv: 222_222,                      // loses to FI
      monthlyContribution: 250,         // would map to 3_000 — loses to FI's 30_000
      ratePercent: 9,                   // returnPct — FI has none, compound wins
      years: 25, variancePercent: 2, frequency: 'MONTHLY', // LOCAL — survive
    }));

    expect(readSharedOverrides()).toEqual({
      portfolio: 600_000, annualContribution: 30_000,
      monthlyExpenses: 4_500, swrPct: 3.8, returnPct: 9,
    });
    // Shared keys stripped; local keys intact; empty silo key removed.
    expect(sessionStorage.getItem('calc-state:financial-independence')).toBeNull();
    expect(JSON.parse(sessionStorage.getItem('calc-state:coast-fi')!)).toEqual({ yearsUntilRetirement: 15 });
    expect(JSON.parse(sessionStorage.getItem('calc-state:compound-interest')!)).toEqual({
      years: 25, variancePercent: 2, frequency: 'MONTHLY',
    });
  });

  it('converts CoastFI/Compound units when FI is absent (÷12, ×100 via pctFromFraction, ×12)', () => {
    sessionStorage.setItem('calc-state:coast-fi', JSON.stringify({ annualExpenses: 66_000, withdrawalRate: 0.035 }));
    sessionStorage.setItem('calc-state:compound-interest', JSON.stringify({ monthlyContribution: 250 }));
    expect(readSharedOverrides()).toEqual({ monthlyExpenses: 5_500, swrPct: 3.5, annualContribution: 3_000 });
  });

  it('is one-shot: an existing shared key means silos are never re-read', () => {
    writeSharedOverrides({ portfolio: 1 });
    sessionStorage.setItem('calc-state:financial-independence', JSON.stringify({ currentPortfolio: 999_999 }));
    expect(readSharedOverrides()).toEqual({ portfolio: 1 });
    // The stale silo is untouched (its card no longer reads shared fields anyway).
    expect(sessionStorage.getItem('calc-state:financial-independence')).not.toBeNull();
  });

  it('idempotent when nothing to migrate: repeated reads return {} and write no key', () => {
    expect(readSharedOverrides()).toEqual({});
    expect(readSharedOverrides()).toEqual({});
    expect(sessionStorage.getItem(SCENARIO_STORAGE_KEY)).toBeNull();
    expect(SCENARIO_FIELDS).toHaveLength(6);
  });

  it('drops non-finite legacy values instead of importing them', () => {
    sessionStorage.setItem('calc-state:financial-independence', JSON.stringify({ currentPortfolio: 'lots', withdrawalRatePct: 4.2 }));
    expect(readSharedOverrides()).toEqual({ swrPct: 4.2 });
  });
});

describe('Wave B: per-scope silos', () => {
  it('scenarioStorageKeyFor: household = the untouched W16 key; person = a sibling silo', () => {
    expect(scenarioStorageKeyFor(null)).toBe('calc-scenario:shared');
    expect(scenarioStorageKeyFor(7)).toBe('calc-scenario:p7');
  });
  it('read/write round-trips a person silo with the same sanitize + empty-removes-key contract', () => {
    writeOverridesFor(7, { portfolio: 500 });
    expect(JSON.parse(sessionStorage.getItem('calc-scenario:p7')!)).toEqual({ portfolio: 500 });
    sessionStorage.setItem('calc-scenario:p7', JSON.stringify({ portfolio: 1, junk: 'x', returnPct: 'NaN' }));
    expect(readOverridesFor(7)).toEqual({ portfolio: 1 });
    writeOverridesFor(7, {});
    expect(sessionStorage.getItem('calc-scenario:p7')).toBeNull();
  });
  it('OWNER CONSTRAINT 2: the one-shot legacy migration never runs for a person silo', () => {
    sessionStorage.setItem('calc-state:financial-independence', JSON.stringify({ currentPortfolio: 123 }));
    expect(readOverridesFor(7)).toEqual({});
    // The legacy silo is untouched (migration is the SHARED key's business):
    expect(sessionStorage.getItem('calc-state:financial-independence')).not.toBeNull();
  });
});

describe('Wave B: scoped buildScenarioDefaults', () => {
  // Fixture shape: p1 owns account 1 ($100k), p2 owns account 2 ($40k),
  // account 3 is joint/null ($8k); contributions: $1,200 for p2 (in-window),
  // $600 unattributed (null), $500 for p1; baseline $6,000/mo.
  const household = mkHousehold({ monthlyExpenseBaseline: 6000 });
  const accounts = [
    { ...mkAccount(1), ownerPersonId: 1 },
    { ...mkAccount(2), ownerPersonId: 2 },
    mkAccount(3), // joint (null owner)
  ] as Account[];
  const snapshots = [
    { accountId: 1, snapshotDate: '2026-07-01', totalValue: 100_000 },
    { accountId: 2, snapshotDate: '2026-07-01', totalValue: 40_000 },
    { accountId: 3, snapshotDate: '2026-07-01', totalValue: 8_000 },
  ];
  const contributions = [
    { accountId: 2, date: '2026-06-15', amount: 1_200, personId: 2 },
    { accountId: 3, date: '2026-06-20', amount: 600, personId: null },
    { accountId: 1, date: '2026-06-25', amount: 500, personId: 1 },
  ];

  it('person scope filters portfolio + contributions and halves expenses, with CB2-CB4 provenance', () => {
    const { defaults, provenance, scopeExclusions } = buildScenarioDefaults({
      household, settings: null, accounts, snapshots, contributions,
      todayIso: '2026-07-30',
      scope: { personId: 2, personName: 'Bob' },
    });
    expect(defaults.portfolio).toBe(40000);
    expect(defaults.annualContribution).toBe(1200);
    expect(defaults.monthlyExpenses).toBe(3000);
    expect(provenance.portfolio).toBe("from Bob's account snapshots — joint accounts not included");
    expect(provenance.annualContribution).toBe("Bob's contributions, last 12 months");
    expect(provenance.monthlyExpenses).toBe('half your household baseline — even split');
    expect(scopeExclusions).toEqual({ jointPortfolio: 8000, unattributedContribution: 600 });
  });
  it('household scope is byte-identical to pre-Wave-B output (no scope input)', () => {
    const before = buildScenarioDefaults({ household, settings: null, accounts, snapshots, contributions, todayIso: '2026-07-30' });
    expect(before.defaults.portfolio).toBe(148000);
    expect(before.provenance.portfolio).toBe('from your account snapshots');
    expect(before.scopeExclusions).toBeNull();
  });
  it('empty scoped states name the person (CB2/CB3 zero variants)', () => {
    const { provenance } = buildScenarioDefaults({
      household, settings: null, accounts: [], snapshots: [], contributions: [],
      todayIso: '2026-07-30', scope: { personId: 2, personName: 'Bob' },
    });
    expect(provenance.portfolio).toBe("no snapshots for Bob's accounts");
    expect(provenance.annualContribution).toBe('no contributions attributed to Bob in the last 12 months');
  });

  // ── Migration 0051: the durable per-person baseline upgrades the default ──

  it("0051: a set person baseline replaces the even split, provenance 'from {name}'s Inputs'", () => {
    const { defaults, provenance } = buildScenarioDefaults({
      household, settings: null, accounts, snapshots, contributions,
      todayIso: '2026-07-30',
      scope: { personId: 2, personName: 'Bob', monthlyExpenseBaseline: 2600 },
    });
    expect(defaults.monthlyExpenses).toBe(2600);
    expect(provenance.monthlyExpenses).toBe("from Bob's Inputs");
  });

  it('0051: a NULL person baseline keeps the labeled even split (CB4 unchanged)', () => {
    const { defaults, provenance } = buildScenarioDefaults({
      household, settings: null, accounts, snapshots, contributions,
      todayIso: '2026-07-30',
      scope: { personId: 2, personName: 'Bob', monthlyExpenseBaseline: null },
    });
    expect(defaults.monthlyExpenses).toBe(3000);
    expect(provenance.monthlyExpenses).toBe('half your household baseline — even split');
  });

  it("0051: an explicit $0 person baseline is honored and still labeled from Inputs (set ≠ unset)", () => {
    const { defaults, provenance } = buildScenarioDefaults({
      household, settings: null, accounts, snapshots, contributions,
      todayIso: '2026-07-30',
      scope: { personId: 2, personName: 'Bob', monthlyExpenseBaseline: 0 },
    });
    expect(defaults.monthlyExpenses).toBe(0);
    expect(provenance.monthlyExpenses).toBe("from Bob's Inputs");
  });

  it('0051: household scope ignores person baselines entirely (no scope input — byte-identical)', () => {
    const { defaults, provenance } = buildScenarioDefaults({
      household, settings: null, accounts, snapshots, contributions, todayIso: '2026-07-30',
    });
    expect(defaults.monthlyExpenses).toBe(6000);
    expect(provenance.monthlyExpenses).toBe('your monthly expense baseline');
  });
});
