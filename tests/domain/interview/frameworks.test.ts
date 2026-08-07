import { describe, it, expect } from 'vitest';
import { FRAMEWORKS, moderateEfMultiple } from '@/domain/interview/frameworks';
import { makePerson } from '../../factories';

describe('moderateEfMultiple (D-GI5)', () => {
  it('3× only when EVERY person answered stable', () => {
    expect(moderateEfMultiple([
      makePerson({ id: 1, jobStability: 'stable' }),
      makePerson({ id: 2, jobStability: 'stable' }),
    ])).toEqual({ multiple: 3, assumed: false });
  });
  it('any unstable → 6×, NOT assumed (explicit answer)', () => {
    expect(moderateEfMultiple([
      makePerson({ id: 1, jobStability: 'stable' }),
      makePerson({ id: 2, jobStability: 'unstable' }),
    ])).toEqual({ multiple: 6, assumed: false });
  });
  it('any unanswered (and none unstable) → 6× ASSUMED (CI-26 trigger)', () => {
    expect(moderateEfMultiple([
      makePerson({ id: 1, jobStability: 'stable' }),
      makePerson({ id: 2, jobStability: null }),
    ])).toEqual({ multiple: 6, assumed: true });
  });
});

describe('policy table', () => {
  it('is exactly conservative/moderate/aggressive with fixed epithets', () => {
    expect(FRAMEWORKS.map((f) => [f.id, f.epithet])).toEqual([
      ['conservative', 'Safety first.'],
      ['moderate', 'The standard order.'],
      ['aggressive', 'Growth-weighted.'],
    ]);
  });
});
