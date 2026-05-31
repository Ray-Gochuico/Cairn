import { describe, it, expect } from 'vitest';
import { prettifyCityCode, US_STATES } from '@/lib/jurisdiction-format';

describe('prettifyCityCode', () => {
  it('drops the state prefix and keeps short all-caps abbreviations', () => {
    expect(prettifyCityCode('NY_NYC')).toBe('NYC');
  });
  it('title-cases longer city names', () => {
    expect(prettifyCityCode('MI_DETROIT')).toBe('Detroit');
  });
  it('title-cases multi-segment county names', () => {
    expect(prettifyCityCode('IN_HAMILTON_COUNTY')).toBe('Hamilton County');
  });
});

describe('US_STATES', () => {
  it('contains all 50 states plus DC (51 entries)', () => {
    expect(US_STATES).toHaveLength(51);
    expect(US_STATES).toContain('CA');
    expect(US_STATES).toContain('DC');
  });
});
