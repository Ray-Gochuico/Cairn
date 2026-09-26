import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  propertyCostBasis,
  rollingExpense,
  linkedSpendingTransactions,
  allLinkedSpending,
  averageMonthlySpending,
} from '@/lib/cost-basis';
import type { Transaction, Category } from '@/types/schema';

const cat = (id: number, isCapital: boolean, type: Category['type'] = 'NEED'): Category => ({
  id, name: `c${id}`, parentCategoryId: 1, color: null, icon: null,
  type, isCapital, systemManaged: false,
});
const txn = (over: Partial<Transaction>): Transaction => ({
  id: 1, householdId: 1, date: '2026-03-05', merchant: 'X', merchantRaw: 'X',
  amount: 100, categoryId: 12, sourceAccountId: null, propertyId: 7, vehicleId: null,
  personId: null, sourcePdfFilename: null, reimbursable: false, reimbursedAt: null,
  reimbursedAmount: null, isRecurring: false, notes: null, ...over,
});
const cats = [cat(12, true), cat(11, false)]; // 12 = Capital Improvements, 11 = Home Maintenance

describe('propertyCostBasis', () => {
  it('sums purchase price plus capital-improvement transactions for the property', () => {
    const txns = [
      txn({ id: 1, amount: 5000, categoryId: 12, propertyId: 7 }), // capital
      txn({ id: 2, amount: 300, categoryId: 11, propertyId: 7 }),  // maintenance, not capital
      txn({ id: 3, amount: 9000, categoryId: 12, propertyId: 9 }), // other property
    ];
    expect(propertyCostBasis(400000, 7, txns, cats)).toBe(405000);
  });
  it('treats a null purchase price as 0', () => {
    expect(propertyCostBasis(null, 7, [], cats)).toBe(0);
  });

  it('nets settled reimbursements out of capital improvements (wave-9 M13)', () => {
    // $10k roof, $4k reimbursed → basis contribution $6k, not $10k.
    const basis = propertyCostBasis(200_000, 7, [
      txn({ amount: 10_000, reimbursable: true, reimbursedAt: '2026-05-01', reimbursedAmount: 4_000 }),
    ], cats);
    expect(basis).toBe(206_000);
  });

  it('skips PENDING reimbursables entirely (wave-9 M13)', () => {
    const basis = propertyCostBasis(200_000, 7, [
      txn({ amount: 10_000, reimbursable: true, reimbursedAt: null, reimbursedAmount: null }),
    ], cats);
    expect(basis).toBe(200_000);
  });
});

describe('rollingExpense', () => {
  it('sums positive linked transactions within the trailing window', () => {
    const txns = [
      txn({ id: 1, amount: 200, propertyId: 7, date: '2026-03-01' }),
      txn({ id: 2, amount: 150, propertyId: 7, date: '2025-01-01' }), // too old
      txn({ id: 3, amount: 80, propertyId: 9, date: '2026-03-01' }),  // other property
    ];
    expect(rollingExpense(txns, { propertyId: 7 }, 12, cats, new Date('2026-03-15T00:00:00Z')))
      .toBe(200);
  });

  it('excludes a pending reimbursable linked transaction', () => {
    // A transaction that is reimbursable but not yet reimbursed must be excluded
    const txns = [
      txn({ id: 1, amount: 300, propertyId: 7, date: '2026-03-01', reimbursable: true, reimbursedAt: null }),
      txn({ id: 2, amount: 200, propertyId: 7, date: '2026-03-01', reimbursable: false }),
    ];
    // Only the non-reimbursable $200 should count
    expect(rollingExpense(txns, { propertyId: 7 }, 12, cats, new Date('2026-03-15T00:00:00Z')))
      .toBe(200);
  });

  it('counts a reimbursed transaction at its net out-of-pocket amount', () => {
    // Paid $500, employer reimbursed $400 → net out-of-pocket $100
    const txns = [
      txn({
        id: 1, amount: 500, propertyId: 7, date: '2026-03-01',
        reimbursable: true, reimbursedAt: '2026-03-10', reimbursedAmount: 400,
      }),
    ];
    expect(rollingExpense(txns, { propertyId: 7 }, 12, cats, new Date('2026-03-15T00:00:00Z')))
      .toBe(100);
  });

  it('excludes transactions in an INCOME-typed category', () => {
    const incomeCat = cat(99, false, 'INCOME');
    const mixedCats = [...cats, incomeCat];
    const txns = [
      txn({ id: 1, amount: 500, propertyId: 7, date: '2026-03-01', categoryId: 99 }), // INCOME
      txn({ id: 2, amount: 200, propertyId: 7, date: '2026-03-01', categoryId: 11 }), // regular NEED
    ];
    // Only the $200 NEED should count
    expect(rollingExpense(txns, { propertyId: 7 }, 12, mixedCats, new Date('2026-03-15T00:00:00Z')))
      .toBe(200);
  });
});

describe('linkedSpendingTransactions', () => {
  it('returns the linked, in-window, real-spending tx sorted newest-first', () => {
    const txns = [
      txn({ id: 1, amount: 200, propertyId: 7, date: '2026-02-01' }),
      txn({ id: 2, amount: 150, propertyId: 7, date: '2026-03-10' }),
      txn({ id: 3, amount: 100, propertyId: 7, date: '2025-01-01' }), // too old
      txn({ id: 4, amount: 80,  propertyId: 9, date: '2026-03-01' }), // other property
    ];
    const out = linkedSpendingTransactions(txns, { propertyId: 7 }, 12, cats, new Date('2026-03-15T00:00:00Z'));
    expect(out.map((t) => t.id)).toEqual([2, 1]);
  });

  it('returns an empty array when nothing is linked', () => {
    const txns = [txn({ id: 1, amount: 200, propertyId: null, date: '2026-03-01' })];
    expect(linkedSpendingTransactions(txns, { propertyId: 7 }, 12, cats, new Date('2026-03-15T00:00:00Z')))
      .toEqual([]);
  });

  it('filters by vehicleId when the link is a vehicle', () => {
    const txns = [
      txn({ id: 1, amount: 50, propertyId: null, vehicleId: 3, date: '2026-03-01' }),
      txn({ id: 2, amount: 90, propertyId: null, vehicleId: 4, date: '2026-03-01' }),
    ];
    const out = linkedSpendingTransactions(txns, { vehicleId: 3 }, 12, cats, new Date('2026-03-15T00:00:00Z'));
    expect(out.map((t) => t.id)).toEqual([1]);
  });

  it('excludes pending reimbursables (mirrors rollingExpense)', () => {
    const txns = [
      txn({ id: 1, amount: 300, propertyId: 7, date: '2026-03-01', reimbursable: true, reimbursedAt: null }),
      txn({ id: 2, amount: 200, propertyId: 7, date: '2026-03-01' }),
    ];
    const out = linkedSpendingTransactions(txns, { propertyId: 7 }, 12, cats, new Date('2026-03-15T00:00:00Z'));
    expect(out.map((t) => t.id)).toEqual([2]);
  });
});

describe('allLinkedSpending', () => {
  it('returns ALL linked real-spending tx with no time cutoff', () => {
    const txns = [
      txn({ id: 1, amount: 100, propertyId: 7, date: '2020-01-15' }), // very old, still kept
      txn({ id: 2, amount: 200, propertyId: 7, date: '2026-03-10' }),
      txn({ id: 3, amount: 999, propertyId: 9, date: '2026-03-10' }), // other property
    ];
    const out = allLinkedSpending(txns, { propertyId: 7 }, cats);
    expect(out.map((t) => t.id).sort()).toEqual([1, 2]);
  });

  it('filters by vehicleId when link is a vehicle', () => {
    const txns = [
      txn({ id: 1, amount: 100, propertyId: null, vehicleId: 3, date: '2024-06-01' }),
      txn({ id: 2, amount: 100, propertyId: null, vehicleId: 4, date: '2024-06-01' }),
    ];
    expect(allLinkedSpending(txns, { vehicleId: 3 }, cats).map((t) => t.id)).toEqual([1]);
  });

  it('still excludes pending reimbursables and income/transfer categories', () => {
    const incomeCat = cat(99, false, 'INCOME');
    const mixed = [...cats, incomeCat];
    const txns = [
      txn({ id: 1, amount: 500, propertyId: 7, categoryId: 99 }),                                  // INCOME
      txn({ id: 2, amount: 300, propertyId: 7, reimbursable: true, reimbursedAt: null }),          // pending
      txn({ id: 3, amount: 200, propertyId: 7 }),                                                  // real
    ];
    expect(allLinkedSpending(txns, { propertyId: 7 }, mixed).map((t) => t.id)).toEqual([3]);
  });
});

describe('averageMonthlySpending', () => {
  const asOf = new Date('2026-03-15T00:00:00Z'); // March 2026

  it('returns 0 for an empty set', () => {
    expect(averageMonthlySpending([], asOf)).toBe(0);
  });

  it('divides total by months from earliest tx through asOf inclusive', () => {
    // Earliest: Jan 2026 → March 2026 = 3 months. Total $600 → $200/mo.
    const txns = [
      txn({ id: 1, amount: 100, date: '2026-01-10' }),
      txn({ id: 2, amount: 200, date: '2026-02-05' }),
      txn({ id: 3, amount: 300, date: '2026-03-01' }),
    ];
    expect(averageMonthlySpending(txns, asOf)).toBe(200);
  });

  it('returns the full total for a single-month dataset', () => {
    // Jan 2026 only → 1-month span → $250 / 1 = $250.
    const txns = [
      txn({ id: 1, amount: 100, date: '2026-01-05' }),
      txn({ id: 2, amount: 150, date: '2026-01-20' }),
    ];
    expect(averageMonthlySpending(txns, new Date('2026-01-31T00:00:00Z'))).toBe(250);
  });

  it('nets reimbursed amount out via effectiveSpendingAmount', () => {
    // $500 charge, $400 reimbursed → $100 effective. 1-month span.
    const txns = [
      txn({
        id: 1, amount: 500, date: '2026-03-01',
        reimbursable: true, reimbursedAt: '2026-03-10', reimbursedAmount: 400,
      }),
    ];
    expect(averageMonthlySpending(txns, new Date('2026-03-31T00:00:00Z'))).toBe(100);
  });
});

describe('v1.8.0 A-2′: the three asOf defaults are the LOCAL day', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });
  // LA_EVENING: Dec 31, 2025 19:00 PST — UTC day Jan 1. AKL_MORNING: Jan 1, 2026 09:00 NZDT — UTC day Dec 31.
  const laEvening = () => {
    process.env.TZ = 'America/Los_Angeles';
    vi.setSystemTime(new Date('2026-01-01T03:00:00Z'));
  };
  const aklMorning = () => {
    process.env.TZ = 'Pacific/Auckland';
    vi.setSystemTime(new Date('2025-12-31T20:00:00Z'));
  };
  const edge = txn({ id: 1, date: '2024-12-31', amount: 70 });
  const inside = txn({ id: 2, date: '2025-06-01', amount: 30 });
  // averageMonthlySpending: earliest 2025-11 through asOf's month, inclusive; $120 total.
  const avgTxns = [txn({ id: 3, date: '2025-11-10', amount: 60 }), txn({ id: 4, date: '2025-12-05', amount: 60 })];

  it('LA evening (Dec 31 locally): the 12-month window opens 2024-12-31 (edge in); Nov–Dec is 2 months ($60/mo)', () => {
    laEvening();
    expect(linkedSpendingTransactions([edge, inside], { propertyId: 7 }, 12, cats).map((t) => t.id)).toEqual([2, 1]);
    expect(rollingExpense([edge, inside], { propertyId: 7 }, 12, cats)).toBe(100);
    expect(averageMonthlySpending(avgTxns)).toBe(60);
  });

  it('Auckland morning (Jan 1 locally): the window opens 2025-01-01 (edge out); Nov–Jan is 3 months ($40/mo)', () => {
    aklMorning();
    expect(linkedSpendingTransactions([edge, inside], { propertyId: 7 }, 12, cats).map((t) => t.id)).toEqual([2]);
    expect(rollingExpense([edge, inside], { propertyId: 7 }, 12, cats)).toBe(30);
    expect(averageMonthlySpending(avgTxns)).toBe(40);
  });
});
