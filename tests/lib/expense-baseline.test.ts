import { describe, it, expect, afterEach } from 'vitest';
import { recentMonthlyExpenseTotals, rolling12mBaseline, rolling12mBaselineDetail, latestCompleteMonthBaseline } from '@/lib/expense-baseline';
import type { Transaction, Category } from '@/types/schema';

// Sign convention: per the Transaction schema, amount > 0 is a purchase/expense
// and amount < 0 is a refund/credit. These tests mirror that convention.
// (The legacy raw-sum baseline helper's describe was deleted with the helper —
// Wave 2 §8; the Roadmap EF rules now use rolling12mBaseline.)

const tx = (id: number, date: string, amount: number): Transaction =>
  ({
    id,
    householdId: 1,
    date,
    amount,
    merchant: 'M',
    merchantRaw: null,
    categoryId: 1,
    sourceAccountId: 1,
  } as unknown as Transaction);

describe('recentMonthlyExpenseTotals', () => {
  it('returns the most recent month totals, descending, limited to N', () => {
    const txs = [
      tx(1, '2026-04-15', 1500), tx(2, '2026-04-20', 200),
      tx(3, '2026-03-01', 2200),
      tx(4, '2026-02-10', 1800),
      tx(5, '2026-01-10', 1700),
      tx(6, '2025-12-31', 1900),
      tx(7, '2025-11-15', 1600),
    ];
    const out = recentMonthlyExpenseTotals(txs, '2026-05-01', 5);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ monthISO: '2026-04', total: 1700 });
    expect(out[1].monthISO).toBe('2026-03');
    expect(out[4].monthISO).toBe('2025-12');
  });

  it('excludes refunds/credits and future months', () => {
    const txs = [
      tx(1, '2026-04-15', -5000), // refund — must be ignored
      tx(2, '2026-04-15', 1000),
      tx(3, '2026-06-15', 500),   // future relative to asOfISO
    ];
    const out = recentMonthlyExpenseTotals(txs, '2026-05-01', 6);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ monthISO: '2026-04', total: 1000 });
  });
});

// Categories that drive isRealSpending: TRANSFER/INCOME are excluded.
const cat = (id: number, type: Category['type']): Category =>
  ({ id, name: `c${id}`, parentCategoryId: null, color: null, icon: null, type, isCapital: false, systemManaged: false, monthlyBudget: null } as Category);
const SPENDING = cat(1, 'EXPENSE');
const TRANSFER = cat(2, 'TRANSFER');
const INCOME = cat(3, 'INCOME');
const categories = [SPENDING, TRANSFER, INCOME];

// reuse the `tx` helper from the top of this file, then override categoryId per case.
const txc = (id: number, date: string, amount: number, categoryId: number): Transaction =>
  ({ ...tx(id, date, amount), categoryId } as Transaction);

describe('rolling12mBaseline — complete calendar months only (R1)', () => {
  // as-of 2026-05-15 → window 2025-05 … 2026-04 (the 12 complete months before May).
  const WINDOW = { fromMonth: '2025-05', toMonth: '2026-04' };

  it('averages distinct observed months and EXCLUDES transfers/income', () => {
    const txs = [
      txc(1, '2026-04-10', 2000, SPENDING.id!),
      txc(2, '2026-04-20', 9999, TRANSFER.id!),  // excluded
      txc(3, '2026-03-05', 2000, SPENDING.id!),  // first real-spending row: day 5 (guard inert)
      txc(4, '2026-02-10', 2000, INCOME.id!),    // excluded — and Feb is NOT an observed month
    ];
    expect(rolling12mBaseline(txs, categories, '2026-05-01')).toBeCloseTo(2000, 0);
    expect(rolling12mBaselineDetail(txs, categories, '2026-05-01').monthsObserved).toBe(2);
  });

  it('nets a reimbursed transaction to out-of-pocket', () => {
    const txs = [
      { ...txc(1, '2026-04-05', 1000, SPENDING.id!), reimbursable: true, reimbursedAt: '2026-04-15', reimbursedAmount: 400 } as Transaction,
    ];
    expect(rolling12mBaseline(txs, categories, '2026-05-01')).toBeCloseTo(600, 0);
  });

  it('returns 0 / monthsObserved 0 with no real spending in the window', () => {
    expect(rolling12mBaseline([], categories, '2026-05-01')).toBe(0);
    expect(rolling12mBaselineDetail([], categories, '2026-05-01')).toEqual({
      average: 0, monthsObserved: 0, window: { fromMonth: '2025-05', toMonth: '2026-04' }, droppedFirstMonth: null,
    });
  });

  // Review MINOR 16: ONE prescriptive fixture pins BOTH edges of the new window
  // plus the in-progress exclusion; the old "exactly 12 months back" / "13 months
  // back" pair is retired into it (neither sat on an edge of [asOf−12, asOf−1]).
  const EDGES = [
    txc(1, '2025-04-30', 9999, SPENDING.id!), // 13 complete months back → OUT (also the history's first real row: day 30, but OUTSIDE the window → guard inert — the established-history case)
    txc(2, '2025-05-30', 1500, SPENDING.id!), // lower edge (12 complete months back) → IN
    txc(3, '2026-04-10', 2500, SPENDING.id!), // upper edge (last complete month) → IN
    txc(4, '2026-05-09', 7777, SPENDING.id!), // as-of (in-progress) month → OUT
  ];
  const EDGES_DETAIL = { average: 2000, monthsObserved: 2, window: WINDOW, droppedFirstMonth: null };

  it('window = the 12 complete months before the as-of month: both edges + in-progress exclusion', () => {
    expect(rolling12mBaselineDetail(EDGES, categories, '2026-05-15')).toEqual(EDGES_DETAIL);
  });

  it('day-of-month invariant: the 1st, the 15th and the 31st resolve the same window', () => {
    expect(rolling12mBaselineDetail(EDGES, categories, '2026-05-01')).toEqual(EDGES_DETAIL);
    expect(rolling12mBaselineDetail(EDGES, categories, '2026-05-31')).toEqual(EDGES_DETAIL);
  });

  it('EXCLUDES the in-progress month (both selectors now share one inclusivity rule)', () => {
    const txs = [
      txc(1, '2026-05-09', 1000, SPENDING.id!), // in-progress → OUT
      txc(2, '2026-04-05', 3000, SPENDING.id!),
    ];
    expect(rolling12mBaseline(txs, categories, '2026-05-15')).toBeCloseTo(3000, 0);
    expect(rolling12mBaselineDetail(txs, categories, '2026-05-15').monthsObserved).toBe(1);
  });

  it('returns 0 when the only data is OLDER than the window', () => {
    const txs = [txc(1, '2024-01-10', 5000, SPENDING.id!)];
    expect(rolling12mBaselineDetail(txs, categories, '2026-05-15')).toEqual({
      average: 0, monthsObserved: 0, window: WINDOW, droppedFirstMonth: null,
    });
  });

  // Review MINOR 14: the COUNT is distinct observed months, never a span.
  it('gap months are not observed: rows in Feb and Apr only → monthsObserved 2, not 3', () => {
    const txs = [txc(1, '2026-02-05', 1000, SPENDING.id!), txc(2, '2026-04-10', 3000, SPENDING.id!)];
    expect(rolling12mBaselineDetail(txs, categories, '2026-05-23')).toEqual({
      average: 2000, monthsObserved: 2, window: WINDOW, droppedFirstMonth: null,
    });
    // A TRANSFER-only March does not become an observed month.
    const withTransfer = [...txs, txc(3, '2026-03-10', 9999, TRANSFER.id!)];
    expect(rolling12mBaselineDetail(withTransfer, categories, '2026-05-23').monthsObserved).toBe(2);
  });

  // The "calm" table (review MINOR 15: a hand-rolled table, not a property library):
  // identical for every day of the as-of month, unmoved by rows added inside it,
  // and identical on the What-If 'YYYY-MM' as-of.
  const CALM = [txc(1, '2025-06-05', 1200, SPENDING.id!), txc(2, '2026-04-10', 2800, SPENDING.id!)];
  it('table: every dd of May 2026 → 2000; added in-May rows never move it; YYYY-MM parity', () => {
    for (let d = 1; d <= 31; d += 1) {
      const dd = String(d).padStart(2, '0');
      expect(rolling12mBaseline(CALM, categories, `2026-05-${dd}`)).toBeCloseTo(2000, 6);
      const withInMonthRow = [...CALM, txc(9, `2026-05-${dd}`, 5000, SPENDING.id!)];
      expect(rolling12mBaseline(withInMonthRow, categories, '2026-05-15')).toBeCloseTo(2000, 6);
    }
    expect(rolling12mBaselineDetail(CALM, categories, '2026-05')).toEqual(
      rolling12mBaselineDetail(CALM, categories, '2026-05-15'),
    );
  });

  it('rolling12mBaseline === rolling12mBaselineDetail(...).average on every fixture above', () => {
    for (const [txs, asOf] of [[EDGES, '2026-05-15'], [CALM, '2026-05-01'], [[], '2026-05-01']] as const) {
      expect(rolling12mBaseline(txs as Transaction[], categories, asOf))
        .toBe(rolling12mBaselineDetail(txs as Transaction[], categories, asOf).average);
    }
  });
});

// ⚑ R1-F6 ON (ruling 3) with D-R1-P2's precision: the guard asks where the
// HISTORY begins, not where the window begins.
describe('rolling12mBaselineDetail — first-observed-month guard (R1-F6, MONTHLY_INPUT_GRACE_DAY = 7)', () => {
  const asOf = '2026-05-15';
  const later = txc(2, '2026-04-10', 3000, SPENDING.id!);

  it('drops a first month whose first real-spending row is after the 7th', () => {
    const txs = [txc(1, '2026-03-15', 1000, SPENDING.id!), later];
    expect(rolling12mBaselineDetail(txs, categories, asOf)).toEqual({
      average: 3000, monthsObserved: 1, window: { fromMonth: '2025-05', toMonth: '2026-04' }, droppedFirstMonth: '2026-03',
    });
  });

  it('keeps a first month that begins on the 7th; drops one that begins on the 8th', () => {
    expect(rolling12mBaselineDetail([txc(1, '2026-03-07', 1000, SPENDING.id!), later], categories, asOf))
      .toMatchObject({ average: 2000, monthsObserved: 2, droppedFirstMonth: null });
    expect(rolling12mBaselineDetail([txc(1, '2026-03-08', 1000, SPENDING.id!), later], categories, asOf))
      .toMatchObject({ average: 3000, monthsObserved: 1, droppedFirstMonth: '2026-03' });
  });

  it('a lone mid-month first month leaves ZERO months (the Household fallback upstream)', () => {
    expect(rolling12mBaselineDetail([txc(1, '2026-04-20', 500, SPENDING.id!)], categories, asOf))
      .toEqual({ average: 0, monthsObserved: 0, window: { fromMonth: '2025-05', toMonth: '2026-04' }, droppedFirstMonth: '2026-04' });
  });

  it('is INERT for an established history: rows older than the window make the window-start month a full month', () => {
    const txs = [
      txc(1, '2025-01-15', 900, SPENDING.id!),  // the history began here — outside the window
      txc(2, '2025-05-09', 1500, SPENDING.id!), // the window's first observed month happens to start on the 9th
      txc(3, '2026-04-10', 2500, SPENDING.id!),
    ];
    expect(rolling12mBaselineDetail(txs, categories, asOf)).toMatchObject({ average: 2000, monthsObserved: 2, droppedFirstMonth: null });
  });

  it('only REAL-spending rows mark the start: a transfer on the 1st and a pending reimbursable on the 2nd do not', () => {
    const txs = [
      txc(1, '2026-03-01', 9999, TRANSFER.id!),
      { ...txc(2, '2026-03-02', 800, SPENDING.id!), reimbursable: true, reimbursedAt: null, reimbursedAmount: null } as Transaction,
      txc(3, '2026-03-12', 1000, SPENDING.id!), // the first REAL row — day 12 → March dropped
      later,
    ];
    expect(rolling12mBaselineDetail(txs, categories, asOf)).toMatchObject({ average: 3000, monthsObserved: 1, droppedFirstMonth: '2026-03' });
  });
});

// Review MINOR 15: date-purity under non-UTC zones. The selector never builds a
// Date; a `new Date('2026-05')` implementation is UTC midnight May 1 = April 30
// local in Los Angeles → window [2025-04, 2026-03] → the 2026-04-10 row drops →
// average 1500 ≠ 2000. These pins must hold in every zone.
describe('rolling12mBaselineDetail — string-only date handling (no zone can shift the window)', () => {
  const originalTZ = process.env.TZ;
  afterEach(() => { process.env.TZ = originalTZ; });
  const EDGES = [
    txc(1, '2025-04-30', 9999, SPENDING.id!), txc(2, '2025-05-30', 1500, SPENDING.id!),
    txc(3, '2026-04-10', 2500, SPENDING.id!), txc(4, '2026-05-09', 7777, SPENDING.id!),
  ];
  it.each(['Pacific/Auckland', 'America/Los_Angeles', 'UTC'])('window + YYYY-MM parity hold in %s', (tz) => {
    process.env.TZ = tz;
    const expected = { average: 2000, monthsObserved: 2, window: { fromMonth: '2025-05', toMonth: '2026-04' }, droppedFirstMonth: null };
    expect(rolling12mBaselineDetail(EDGES, categories, '2026-05-15')).toEqual(expected);
    expect(rolling12mBaselineDetail(EDGES, categories, '2026-05')).toEqual(expected);     // the What-If as-of
    expect(rolling12mBaselineDetail(EDGES, categories, '2026-05-01')).toEqual(expected);
  });
});

// Ruling 7: the recorded bug class (5,911 → 4,478 on a $96 row posting on the
// 1st) pinned as an anchor across a LOCAL month boundary, at the selector.
describe('rolling12mBaselineDetail — cross-month-boundary anchor (a row on the 1st never moves the figure)', () => {
  const THREE = [
    txc(1, '2026-04-01', 5800.00, SPENDING.id!),
    txc(2, '2026-05-01', 5911.12, SPENDING.id!),
    txc(3, '2026-06-01', 6022.24, SPENDING.id!),
  ]; // distinct amounts (review MINOR 13); (5800 + 5911.12 + 6022.24) / 3 = 5911.12
  const JULY_1 = txc(4, '2026-07-01', 96.31, SPENDING.id!);

  it('July 1st, 15th and 31st read the same three-month figure, with or without the July-1 row', () => {
    for (const asOf of ['2026-07-01', '2026-07-15', '2026-07-31']) {
      const withRow = rolling12mBaselineDetail([...THREE, JULY_1], categories, asOf);
      expect(withRow.average).toBeCloseTo(5911.12, 2);
      expect(withRow).toMatchObject({ monthsObserved: 3, window: { fromMonth: '2025-07', toMonth: '2026-06' }, droppedFirstMonth: null });
      expect(withRow).toEqual(rolling12mBaselineDetail(THREE, categories, asOf));
    }
  });

  it('the one move happens on the 1st and is June entering — June 30 reads the two-month figure', () => {
    const d = rolling12mBaselineDetail([...THREE, JULY_1], categories, '2026-06-30');
    expect(d.average).toBeCloseTo(5855.56, 2); // (5800 + 5911.12) / 2
    expect(d).toMatchObject({ monthsObserved: 2, window: { fromMonth: '2025-06', toMonth: '2026-05' } });
  });
});

describe('latestCompleteMonthBaseline — excludes the in-progress month', () => {
  it('mid-month asOf returns the PRIOR complete month, not the in-progress one', () => {
    const txs = [
      txc(1, '2026-05-10', 5000, SPENDING.id!), // in-progress (asOf is 2026-05-15) — excluded
      txc(2, '2026-04-12', 3000, SPENDING.id!), // latest COMPLETE month
      txc(3, '2026-03-12', 2000, SPENDING.id!),
    ];
    expect(latestCompleteMonthBaseline(txs, categories, '2026-05-15')).toBeCloseTo(3000, 0);
  });

  it('1st-of-month asOf still excludes that month (it is in progress)', () => {
    const txs = [
      txc(1, '2026-05-01', 5000, SPENDING.id!), // month 2026-05 == asOf month — excluded
      txc(2, '2026-04-12', 3000, SPENDING.id!),
    ];
    expect(latestCompleteMonthBaseline(txs, categories, '2026-05-01')).toBeCloseTo(3000, 0);
  });

  it('returns 0 when the only data is in the in-progress month (empty-after-exclusion)', () => {
    const txs = [txc(1, '2026-05-09', 5000, SPENDING.id!)];
    expect(latestCompleteMonthBaseline(txs, categories, '2026-05-15')).toBe(0);
  });

  it('sums multiple charges within the latest complete month', () => {
    const txs = [
      txc(1, '2026-04-03', 1200, SPENDING.id!),
      txc(2, '2026-04-27', 800, SPENDING.id!),
      txc(3, '2026-04-15', 500, TRANSFER.id!), // excluded
    ];
    expect(latestCompleteMonthBaseline(txs, categories, '2026-05-20')).toBeCloseTo(2000, 0);
  });
});
