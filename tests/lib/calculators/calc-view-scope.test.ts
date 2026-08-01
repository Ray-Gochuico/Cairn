import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCalcScopePersonId,
  subscribeCalcScope,
  syncCalcScope,
  __resetCalcScopeForTests,
} from '@/lib/calculators/calc-view-scope';
import { getEarnerEpoch } from '@/lib/calculators/use-selected-earner';

describe('calc-view-scope mirror', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetCalcScopeForTests();
  });

  it('defaults to household (null) and notifies subscribers on change', () => {
    expect(getCalcScopePersonId()).toBeNull();
    let fired = 0;
    const unsub = subscribeCalcScope(() => { fired += 1; });
    syncCalcScope(2);
    expect(getCalcScopePersonId()).toBe(2);
    expect(fired).toBe(1);
    unsub();
  });

  it('a REAL scope change clears every calc-earner:* pick and bumps the epoch; a no-op sync clears nothing', () => {
    sessionStorage.setItem('calc-earner:paycheck', '1');
    sessionStorage.setItem('calc-earner:overtime', '2');
    sessionStorage.setItem('calc-scenario:shared', '{"portfolio":1}'); // NOT an earner pick
    const epochBefore = getEarnerEpoch();
    syncCalcScope(null); // already null — no-op
    expect(sessionStorage.getItem('calc-earner:paycheck')).toBe('1');
    syncCalcScope(2);
    expect(sessionStorage.getItem('calc-earner:paycheck')).toBeNull();
    expect(sessionStorage.getItem('calc-earner:overtime')).toBeNull();
    expect(sessionStorage.getItem('calc-scenario:shared')).toBe('{"portfolio":1}');
    expect(getEarnerEpoch()).toBe(epochBefore + 1);
  });
});
