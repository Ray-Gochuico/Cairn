import { describe, expect, it } from 'vitest';
import { hiddenClause, partitionHidden, scopeSuffix, withViewSearch } from '@/lib/view-scope';

describe('scopeSuffix', () => {
  it('is empty for household, " · Household" otherwise', () => {
    expect(scopeSuffix('household')).toBe('');
    expect(scopeSuffix('p1')).toBe(' · Household');
    expect(scopeSuffix('joint')).toBe(' · Household');
  });
});

describe('partitionHidden', () => {
  const rows = [
    { id: 1, ownerPersonId: 1 },
    { id: 2, ownerPersonId: 2 },
    { id: 3, ownerPersonId: null },
    { id: 4, ownerPersonId: null },
  ];
  it('splits hidden rows into joint vs other (reference identity)', () => {
    const visible = rows.filter((r) => r.ownerPersonId === 1); // the p1 slice
    expect(partitionHidden(rows, visible, (r) => r.ownerPersonId)).toEqual({
      total: 4, visibleCount: 1, hiddenCount: 3, jointCount: 2, otherCount: 1,
    });
  });
  it('household view (visible === all) hides nothing', () => {
    expect(partitionHidden(rows, rows, (r) => r.ownerPersonId).hiddenCount).toBe(0);
  });
});

describe('hiddenClause', () => {
  const p = (jointCount: number, otherCount: number) => ({
    total: 9, visibleCount: 9 - jointCount - otherCount,
    hiddenCount: jointCount + otherCount, jointCount, otherCount,
  });
  it('person view: joint and other', () => {
    expect(hiddenClause(p(2, 1), { filter: 'p1', otherName: 'Bob' }))
      .toBe('2 joint and 1 owned by Bob');
    expect(hiddenClause(p(2, 0), { filter: 'p1', otherName: 'Bob' })).toBe('2 joint');
    expect(hiddenClause(p(0, 3), { filter: 'p1', otherName: 'Bob' })).toBe('3 owned by Bob');
  });
  it('goals grammar: shared / for', () => {
    expect(hiddenClause(p(1, 2), { filter: 'p2', otherName: 'Alice', jointWord: 'shared', otherVerb: 'for' }))
      .toBe('1 shared and 2 for Alice');
  });
  it('joint view: individually owned', () => {
    expect(hiddenClause(p(0, 3), { filter: 'joint', otherName: null })).toBe('3 individually owned');
  });
});

describe('withViewSearch', () => {
  it('appends the current view', () => {
    expect(withViewSearch('/spending/transactions', '?view=p2')).toBe('/spending/transactions?view=p2');
  });
  it('passes through when no view is active', () => {
    expect(withViewSearch('/spending', '')).toBe('/spending');
    expect(withViewSearch('/spending', '?chart=investments')).toBe('/spending');
  });
  it('preserves existing query params and never clobbers an explicit view', () => {
    expect(withViewSearch('/net-worth?chart=investments', '?view=joint'))
      .toBe('/net-worth?chart=investments&view=joint');
    expect(withViewSearch('/loans?view=p1', '?view=p2')).toBe('/loans?view=p1');
  });
});
