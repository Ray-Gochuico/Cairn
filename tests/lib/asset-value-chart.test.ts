import { describe, it, expect } from 'vitest';
import {
  RANGE_TABS,
  granularityForWindow,
  earliestObservationIso,
  clampDisplayDate,
  formatBucketDate,
  buildAssetValueView,
  deltaPctOrNull,
  xTicksFor,
  xTickLabel,
  headerLabel,
  buildBreakdownRows,
  tooltipRows,
  estimateBackedKeys,
  netWorthAsOfFactory,
} from '@/lib/asset-value-chart';
import { loanBalanceHistory } from '@/lib/loan-history';
import type { NetWorthChartRow } from '@/lib/net-worth-chart-data';
import type { AssetValueSnapshot, Loan } from '@/types/schema';

const TODAY = '2026-06-12';

function row(bucketEnd: string, netWorth: number): NetWorthChartRow {
  return { bucketEnd, netWorth };
}

describe('RANGE_TABS', () => {
  it('is the spec tab set in order', () => {
    expect(RANGE_TABS.map((t) => t.value)).toEqual(['3M', '6M', 'YTD', '1Y', '5Y', 'ALL']);
  });
});

describe('granularityForWindow', () => {
  it('short windows are weekly, 5Y monthly', () => {
    expect(granularityForWindow('3M', null, TODAY)).toBe('WEEK');
    expect(granularityForWindow('6M', null, TODAY)).toBe('WEEK');
    expect(granularityForWindow('YTD', null, TODAY)).toBe('WEEK');
    expect(granularityForWindow('1Y', null, TODAY)).toBe('WEEK');
    expect(granularityForWindow('5Y', null, TODAY)).toBe('MONTH');
  });
  it('ALL adapts to the data span (MONTH ≤88mo, QUARTER ≤264mo, else YEAR)', () => {
    expect(granularityForWindow('ALL', '2020-01-15', TODAY)).toBe('MONTH');   // 77 mo
    expect(granularityForWindow('ALL', '2010-01-15', TODAY)).toBe('QUARTER'); // 197 mo
    expect(granularityForWindow('ALL', '1995-01-15', TODAY)).toBe('YEAR');    // 377 mo
    expect(granularityForWindow('ALL', null, TODAY)).toBe('MONTH');
  });
  it('ALL: MONTH/QUARTER edge at exactly 88 vs 89 months', () => {
    // monthsBetween ignores day-of-month: (2026−2019)*12 + (Jun − Feb) = 84 + 4 = 88
    expect(granularityForWindow('ALL', '2019-02-15', TODAY)).toBe('MONTH');   // 88 mo — last MONTH
    expect(granularityForWindow('ALL', '2019-01-15', TODAY)).toBe('QUARTER'); // 89 mo — first QUARTER
  });
  it('ALL: QUARTER/YEAR edge at exactly 264 vs 265 months', () => {
    // (2026−2004)*12 + (Jun − Jun) = 264; one month earlier = 265
    expect(granularityForWindow('ALL', '2004-06-15', TODAY)).toBe('QUARTER'); // 264 mo — last QUARTER
    expect(granularityForWindow('ALL', '2004-05-15', TODAY)).toBe('YEAR');    // 265 mo — first YEAR
  });
});

describe('earliestObservationIso (mirrors the builder observation starts)', () => {
  it('property purchaseDate anchors the span before its first snapshot', () => {
    expect(
      earliestObservationIso({
        selectedKeys: new Set(['property:7']),
        snapshots: [],
        assetValueSnapshots: [
          { ownerType: 'PROPERTY', ownerId: 7, snapshotDate: '2024-03-31' },
        ],
        properties: [{ id: 7, purchaseDate: '2015-08-01' }],
        vehicles: [],
      }),
    ).toBe('2015-08-01');
  });

  it('min(first snapshot, purchaseDate): the earlier snapshot wins', () => {
    expect(
      earliestObservationIso({
        selectedKeys: new Set(['vehicle:3']),
        snapshots: [],
        assetValueSnapshots: [
          { ownerType: 'VEHICLE', ownerId: 3, snapshotDate: '2018-04-01' },
        ],
        properties: [],
        vehicles: [{ id: 3, purchaseDate: '2019-09-01' }],
      }),
    ).toBe('2018-04-01');
  });

  it('accounts-only: min selected snapshot date', () => {
    expect(
      earliestObservationIso({
        selectedKeys: new Set(['account:1', 'account:2']),
        snapshots: [
          { accountId: 1, snapshotDate: '2025-07-10' },
          { accountId: 2, snapshotDate: '2024-11-02' },
        ],
        assetValueSnapshots: [],
        properties: [],
        vehicles: [],
      }),
    ).toBe('2024-11-02');
  });

  it('unselected entities are ignored', () => {
    expect(
      earliestObservationIso({
        selectedKeys: new Set(['account:1']),
        snapshots: [
          { accountId: 1, snapshotDate: '2025-07-10' },
          { accountId: 2, snapshotDate: '2019-01-01' }, // not selected
        ],
        assetValueSnapshots: [
          { ownerType: 'VEHICLE', ownerId: 3, snapshotDate: '2018-01-01' }, // not selected
        ],
        properties: [{ id: 7, purchaseDate: '2015-08-01' }], // not selected
        vehicles: [{ id: 3, purchaseDate: '2016-02-01' }], // not selected
      }),
    ).toBe('2025-07-10');
  });

  it('nothing selected / no observations → null', () => {
    expect(
      earliestObservationIso({
        selectedKeys: new Set<string>(),
        snapshots: [{ accountId: 1, snapshotDate: '2025-07-10' }],
        assetValueSnapshots: [],
        properties: [],
        vehicles: [],
      }),
    ).toBeNull();
  });
});

describe('clampDisplayDate / formatBucketDate', () => {
  it('clamps future bucket ends to today', () => {
    expect(clampDisplayDate('2026-06-30', TODAY)).toBe(TODAY);
    expect(clampDisplayDate('2026-05-31', TODAY)).toBe('2026-05-31');
  });
  it('formats as "Mmm D, YYYY" in UTC', () => {
    expect(formatBucketDate('2026-03-31', TODAY)).toBe('Mar 31, 2026');
    expect(formatBucketDate('2026-06-30', TODAY)).toBe('Jun 12, 2026'); // clamped
  });
});

describe('deltaPctOrNull', () => {
  it('null for baseline ≤ 0', () => {
    expect(deltaPctOrNull(100, 0)).toBeNull();
    expect(deltaPctOrNull(100, -5)).toBeNull();
  });
  it('null beyond ±999.9% (near-zero baseline)', () => {
    expect(deltaPctOrNull(120, 12)).toBeNull();          // 1000% > 999.9 → null
    expect(deltaPctOrNull(119, 12)).toBeCloseTo(991.7, 1);
  });
  it('plain percentage otherwise', () => {
    expect(deltaPctOrNull(8600, 100000)).toBeCloseTo(8.6, 5);
  });
});

describe('buildAssetValueView', () => {
  const rows = [
    row('2025-06-30', 100000),
    row('2025-12-31', 120000),
    row('2026-06-30', 138600),
  ];
  it('derives latest, baseline, delta, pct', () => {
    const v = buildAssetValueView(rows, '1Y', 'MONTH', TODAY);
    expect(v.latest?.value).toBe(138600);
    expect(v.baseline?.value).toBe(100000);
    expect(v.delta).toBe(38600);
    expect(v.deltaPct).toBeCloseTo(38.6, 5);
    expect(v.phrase).toBe('past year');
  });
  it('uses "since <Mmm YYYY>" when data starts inside the window', () => {
    const shortRows = [row('2026-03-31', 100), row('2026-06-30', 200)];
    const v = buildAssetValueView(shortRows, '1Y', 'MONTH', TODAY);
    expect(v.phrase).toBe('since Mar 2026');
  });
  it('WEEK boundary: one bucket late triggers the since-phrase', () => {
    // 1Y cutoff from 2026-06-12 = 2025-06-12 → firstExpected = bucketEndFor(WEEK) = '2025-06-14' (Sat).
    // First row one week-bucket later → data starts inside the window.
    const late = [row('2025-06-21', 100), row('2026-06-13', 200)];
    const v = buildAssetValueView(late, '1Y', 'WEEK', TODAY);
    expect(v.phrase).toBe('since Jun 2025');
  });
  it('WEEK boundary: first bucket exactly at firstExpected keeps the window phrase', () => {
    const exact = [row('2025-06-14', 100), row('2026-06-13', 200)];
    const v = buildAssetValueView(exact, '1Y', 'WEEK', TODAY);
    expect(v.phrase).toBe('past year');
  });
  it('YTD full coverage: phrase is "this year"', () => {
    // YTD cutoff = 2026-01-01 → firstExpected = bucketEndFor(WEEK) = '2026-01-03' (Sat).
    const full = [row('2026-01-03', 100), row('2026-06-13', 200)];
    const v = buildAssetValueView(full, 'YTD', 'WEEK', TODAY);
    expect(v.phrase).toBe('this year');
  });
  it('YTD late start: phrase is "since <Mmm YYYY>"', () => {
    const late = [row('2026-03-07', 100), row('2026-06-13', 200)];
    const v = buildAssetValueView(late, 'YTD', 'WEEK', TODAY);
    expect(v.phrase).toBe('since Mar 2026');
  });
  it('ALL is always "all time"', () => {
    const v = buildAssetValueView(rows, 'ALL', 'MONTH', TODAY);
    expect(v.phrase).toBe('all time');
  });
  it('single point: no delta', () => {
    const v = buildAssetValueView([row('2026-06-30', 5)], '1Y', 'MONTH', TODAY);
    expect(v.delta).toBeNull();
    expect(v.deltaPct).toBeNull();
  });
  it('empty rows: empty view', () => {
    const v = buildAssetValueView([], '1Y', 'MONTH', TODAY);
    expect(v.points).toEqual([]);
    expect(v.latest).toBeNull();
  });
});

describe('x ticks', () => {
  it('≤1Y windows: first bucket of each month, labeled MMM', () => {
    const rows = [
      row('2026-04-04', 1), row('2026-04-11', 1), row('2026-05-02', 1),
      row('2026-05-09', 1), row('2026-06-06', 1),
    ];
    expect(xTicksFor(rows, '3M')).toEqual(['2026-04-04', '2026-05-02', '2026-06-06']);
    expect(xTickLabel('2026-04-04', '3M')).toBe('Apr');
  });
  it('5Y/ALL: first bucket of each year, labeled YYYY', () => {
    const rows = [
      row('2025-11-30', 1), row('2025-12-31', 1), row('2026-01-31', 1), row('2026-02-28', 1),
    ];
    expect(xTicksFor(rows, '5Y')).toEqual(['2025-11-30', '2026-01-31']);
    expect(xTickLabel('2026-01-31', '5Y')).toBe('2026');
  });
});

describe('headerLabel (spec §3.1 strict rules)', () => {
  const assets = ['account:1', 'account:2', 'property:7'];
  const loans = ['loan:9'];
  const names = new Map([
    ['account:1', 'Schwab'], ['account:2', '401k'], ['property:7', 'Home'], ['loan:9', 'Mortgage'],
  ]);
  const label = (selected: string[]) =>
    headerLabel({ selected: new Set(selected), eligibleAssets: assets, eligibleLoans: loans, nameByKey: names });

  it('"Net worth" only for the entire eligible set', () => {
    expect(label([...assets, ...loans])).toBe('Net worth');
  });
  it('"Net worth" for all assets when there are no eligible loans at all', () => {
    expect(headerLabel({ selected: new Set(assets), eligibleAssets: assets, eligibleLoans: [], nameByKey: names })).toBe('Net worth');
  });
  it('"Included net" for a partial pick containing a loan', () => {
    expect(label(['account:1', 'loan:9'])).toBe('Included net');
  });
  it('"Total assets" for all assets, no loans selected (loans exist)', () => {
    expect(label(assets)).toBe('Total assets');
  });
  it('"Included assets" for a partial assets-only pick', () => {
    expect(label(['account:1', 'property:7'])).toBe('Included assets');
  });
  it('single entity: its name', () => {
    expect(label(['account:1'])).toBe('Schwab');
  });
});

describe('buildBreakdownRows', () => {
  const current = { bucketEnd: '2026-06-30', netWorth: 200, 'account:1': 500, 'property:7': 0, 'loan:9': -300 } as NetWorthChartRow;
  const baseline = { bucketEnd: '2026-01-31', netWorth: 80, 'account:1': 400, 'property:7': 0, 'loan:9': -320 } as NetWorthChartRow;
  const entities = [
    { key: 'account:1', kind: 'account' as const, name: 'Schwab' },
    { key: 'property:7', kind: 'property' as const, name: 'Home' },
    { key: 'loan:9', kind: 'loan' as const, name: 'Mortgage' },
  ];

  it('loan Δ = change in net-worth contribution (paydown positive); Δ% null for loans', () => {
    const rows = buildBreakdownRows({
      currentRow: current, baselineRow: baseline, entities,
      estimateBacked: new Set(['property:7']), latestObservationByKey: new Map(), previousBucketEnd: '2026-05-31',
    });
    const loan = rows.find((r) => r.key === 'loan:9')!;
    expect(loan.value).toBe(-300);
    expect(loan.delta).toBe(20); // −300 − (−320)
    expect(loan.deltaPct).toBeNull();
  });

  it('share of assets: assets only, loans null; rows sorted by |value| desc; Σ row Δ == header Δ', () => {
    const rows = buildBreakdownRows({
      currentRow: current, baselineRow: baseline, entities,
      estimateBacked: new Set(), latestObservationByKey: new Map(), previousBucketEnd: null,
    });
    expect(rows.map((r) => r.key)).toEqual(['account:1', 'loan:9', 'property:7']);
    expect(rows.find((r) => r.key === 'account:1')!.share).toBeCloseTo(1.0, 5); // 500 / 500
    expect(rows.find((r) => r.key === 'loan:9')!.share).toBeNull();
    expect(rows.every((r) => r.delta !== null)).toBe(true); // baseline present → deltas non-null
    expect(rows.reduce((s, r) => s + (r.delta ?? 0), 0)).toBe(200 - 80);
  });

  it('null baseline (single-point series): every row has delta and deltaPct null', () => {
    const rows = buildBreakdownRows({
      currentRow: current, baselineRow: null, entities,
      estimateBacked: new Set(), latestObservationByKey: new Map(), previousBucketEnd: null,
    });
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.delta).toBeNull();
      expect(r.deltaPct).toBeNull();
    }
  });

  it('negative-value account: excluded from gross assets, share null, still listed signed', () => {
    const cur = { bucketEnd: '2026-06-30', netWorth: 400, 'account:1': 500, 'account:2': -100 } as NetWorthChartRow;
    const rows = buildBreakdownRows({
      currentRow: cur, baselineRow: null,
      entities: [
        { key: 'account:1', kind: 'account' as const, name: 'Schwab' },
        { key: 'account:2', kind: 'account' as const, name: 'Margin' },
      ],
      estimateBacked: new Set(), latestObservationByKey: new Map(), previousBucketEnd: null,
    });
    const neg = rows.find((r) => r.key === 'account:2')!;
    expect(neg.value).toBe(-100); // present, signed
    expect(neg.share).toBeNull();
    expect(rows.find((r) => r.key === 'account:1')!.share).toBeCloseTo(1.0, 5); // 500 / 500 — negative excluded from gross
  });

  it('estimate-backed entity with positive value still counts toward gross and gets a share', () => {
    const cur = { bucketEnd: '2026-06-30', netWorth: 800, 'account:1': 500, 'property:7': 300 } as NetWorthChartRow;
    const rows = buildBreakdownRows({
      currentRow: cur, baselineRow: null,
      entities: [
        { key: 'account:1', kind: 'account' as const, name: 'Schwab' },
        { key: 'property:7', kind: 'property' as const, name: 'Home' },
      ],
      estimateBacked: new Set(['property:7']), latestObservationByKey: new Map(), previousBucketEnd: null,
    });
    const home = rows.find((r) => r.key === 'property:7')!;
    expect(home.estimateBacked).toBe(true);
    expect(home.share).toBeCloseTo(300 / 800, 5);
    expect(rows.find((r) => r.key === 'account:1')!.share).toBeCloseTo(500 / 800, 5);
  });

  it('estimate-backed rows are flagged; stale rows carry their as-of date', () => {
    const rows = buildBreakdownRows({
      currentRow: current, baselineRow: baseline, entities,
      estimateBacked: new Set(['property:7']),
      latestObservationByKey: new Map([['account:1', '2026-03-15']]),
      previousBucketEnd: '2026-05-31',
    });
    expect(rows.find((r) => r.key === 'property:7')!.estimateBacked).toBe(true);
    expect(rows.find((r) => r.key === 'account:1')!.asOf).toBe('2026-03-15'); // older than prev bucket
    expect(rows.find((r) => r.key === 'loan:9')!.asOf).toBeNull();
  });
});

describe('tooltipRows', () => {
  it('top-5 by |value| with a signed remainder', () => {
    const r = {
      bucketEnd: '2026-06-30', netWorth: 0,
      'account:1': 500, 'account:2': 400, 'account:3': 300, 'account:4': 200,
      'account:5': 100, 'account:6': 50, 'loan:9': -75,
    } as NetWorthChartRow;
    const names = new Map(
      ['1', '2', '3', '4', '5', '6'].map((n) => [`account:${n}`, `A${n}`] as [string, string]),
    );
    names.set('loan:9', 'Mortgage');
    const t = tooltipRows(r, names, 5);
    expect(t.rows.map((x) => x.name)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
    expect(t.moreCount).toBe(2);
    expect(t.moreSum).toBe(50 - 75); // signed: -25
  });

  it('≤max entries: moreCount 0, moreSum 0; zero-value entries excluded', () => {
    const r = {
      bucketEnd: '2026-06-30', netWorth: 425,
      'account:1': 500, 'account:2': 0, 'loan:9': -75,
    } as NetWorthChartRow;
    const names = new Map([
      ['account:1', 'A1'], ['account:2', 'A2'], ['loan:9', 'Mortgage'],
    ]);
    const t = tooltipRows(r, names, 5);
    expect(t.rows.map((x) => x.name)).toEqual(['A1', 'Mortgage']); // zero-value A2 excluded
    expect(t.moreCount).toBe(0);
    expect(t.moreSum).toBe(0);
  });
});

describe('estimateBackedKeys', () => {
  it('flags properties/vehicles with zero snapshots', () => {
    const snaps: Array<Pick<AssetValueSnapshot, 'ownerType' | 'ownerId'>> = [
      { ownerType: 'PROPERTY', ownerId: 7 },
    ];
    const keys = estimateBackedKeys(
      [
        { key: 'property:7', kind: 'property', id: 7 },
        { key: 'vehicle:3', kind: 'vehicle', id: 3 },
        { key: 'account:1', kind: 'account', id: 1 },
      ],
      snaps,
    );
    expect(keys).toEqual(new Set(['vehicle:3']));
  });
});

describe('netWorthAsOfFactory', () => {
  it('null before any account history; otherwise accounts + assets − loans', () => {
    const valueAsOf = netWorthAsOfFactory({
      snapshots: [{ accountId: 1, snapshotDate: '2026-02-10', totalValue: 1000 }],
      properties: [{ id: 7, purchaseDate: null, purchasePrice: null, currentEstimatedValue: 500, excludedFromNetWorth: false }],
      vehicles: [],
      loans: [],
      assetValueSnapshots: [],
      todayIso: '2026-06-12',
    });
    expect(valueAsOf('2026-01-15')).toBeNull();
    expect(valueAsOf('2026-03-15')).toBe(1500);
  });

  it('loan leg back-walks from today — a historical date owes MORE than currentBalance', () => {
    const loan: Loan = {
      id: 9,
      householdId: 1,
      obligorPersonId: null,
      name: 'Mortgage',
      type: 'MORTGAGE',
      originalAmount: 400000,
      currentBalance: 350000,
      interestRate: 0.04,
      termMonths: 360,
      firstPaymentDate: '2024-01-01',
      monthlyPayment: 1909.66,
      extraPaymentDefault: 0,
      linkedPropertyId: null,
      linkedVehicleId: null,
    };
    const todayIso = '2026-06-12';
    const valueAsOf = netWorthAsOfFactory({
      snapshots: [{ accountId: 1, snapshotDate: '2020-01-01', totalValue: 1_000_000 }],
      properties: [],
      vehicles: [],
      loans: [loan],
      assetValueSnapshots: [],
      todayIso,
    });
    const date = '2025-12-12'; // ~6 months before today
    // Oracle: the same back-walk the chart's loan series uses.
    const oracle = loanBalanceHistory(loan, date, todayIso, 'DAY', todayIso)[0].balance;
    expect(oracle).toBeGreaterThan(350000); // earlier in the amortization → larger balance
    expect(valueAsOf(date)).toBeCloseTo(1_000_000 - oracle, 2); // matches the walk within $0.01
  });

  it('vehicles leg adds in; excludedFromNetWorth and id-less assets are skipped', () => {
    const valueAsOf = netWorthAsOfFactory({
      snapshots: [{ accountId: 1, snapshotDate: '2026-01-01', totalValue: 1000 }],
      properties: [
        { id: 8, purchaseDate: null, purchasePrice: null, currentEstimatedValue: 999, excludedFromNetWorth: true }, // skipped: excluded
      ],
      vehicles: [
        { id: 3, purchaseDate: null, purchasePrice: null, currentEstimatedValue: 200, excludedFromNetWorth: false }, // counted
        { purchaseDate: null, purchasePrice: null, currentEstimatedValue: 111, excludedFromNetWorth: false }, // skipped: no id
      ],
      loans: [],
      assetValueSnapshots: [],
      todayIso: '2026-06-12',
    });
    expect(valueAsOf('2026-03-15')).toBe(1200); // 1000 + vehicle 200 only
  });
});
