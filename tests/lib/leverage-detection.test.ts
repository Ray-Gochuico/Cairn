import { describe, it, expect } from 'vitest';
import { detectLeverage } from '@/lib/leverage-detection';

describe('detectLeverage', () => {
  it('detects 3x in known symbols', () => {
    expect(detectLeverage('TQQQ', null)).toEqual({ leverageFactor: 3, direction: 'LONG' });
    expect(detectLeverage('UPRO', null)).toEqual({ leverageFactor: 3, direction: 'LONG' });
    expect(detectLeverage('TMF', null)).toEqual({ leverageFactor: 3, direction: 'LONG' });
  });
  it('detects 2x in known symbols', () => {
    expect(detectLeverage('QLD', null)).toEqual({ leverageFactor: 2, direction: 'LONG' });
    expect(detectLeverage('SSO', null)).toEqual({ leverageFactor: 2, direction: 'LONG' });
  });
  it('detects SHORT direction from "Inverse" or "Bear" in name', () => {
    expect(detectLeverage('SQQQ', 'ProShares UltraPro Short QQQ'))
      .toEqual({ leverageFactor: 3, direction: 'SHORT' });
  });
  it('returns leverageFactor=1 LONG for non-leveraged tickers', () => {
    expect(detectLeverage('VTI', 'Vanguard Total Stock')).toEqual({ leverageFactor: 1, direction: 'LONG' });
  });
  it('detects 3x from "Triple" in name when symbol is unknown', () => {
    expect(detectLeverage('NEWXX', 'Triple Leveraged Energy Fund'))
      .toEqual({ leverageFactor: 3, direction: 'LONG' });
  });
});
