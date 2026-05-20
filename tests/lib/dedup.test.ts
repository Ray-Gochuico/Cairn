import { describe, it, expect } from 'vitest';
import { transactionDedupKey, filterDuplicates } from '@/lib/dedup';

describe('transactionDedupKey', () => {
  it('is stable over date + amount + uppercased merchantRaw', () => {
    expect(transactionDedupKey({ date: '2026-03-05', amount: 54.2, merchantRaw: 'amazon' }))
      .toBe(transactionDedupKey({ date: '2026-03-05', amount: 54.2, merchantRaw: 'AMAZON' }));
  });
  it('tolerates a null merchantRaw', () => {
    expect(() => transactionDedupKey({ date: '2026-03-05', amount: 1, merchantRaw: null }))
      .not.toThrow();
  });
});

describe('filterDuplicates', () => {
  it('separates fresh candidates from ones already in the existing set', () => {
    const existing = [{ date: '2026-03-05', amount: 54.23, merchantRaw: 'AMAZON.COM' }];
    const candidates = [
      { date: '2026-03-05', amount: 54.23, merchantRaw: 'AMAZON.COM', tag: 'dup' },
      { date: '2026-03-06', amount: 9.99, merchantRaw: 'SPOTIFY', tag: 'new' },
    ];
    const { fresh, duplicates } = filterDuplicates(candidates, existing);
    expect(fresh.map((f) => f.tag)).toEqual(['new']);
    expect(duplicates.map((d) => d.tag)).toEqual(['dup']);
  });
  it('also dedups within the candidate batch itself', () => {
    const c = { date: '2026-03-06', amount: 9.99, merchantRaw: 'SPOTIFY' };
    const { fresh, duplicates } = filterDuplicates([c, { ...c }], []);
    expect(fresh).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });
});
