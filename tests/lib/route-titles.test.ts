import { describe, expect, it } from 'vitest';
import { documentTitleFor, titleForPath } from '@/lib/route-titles';

describe('titleForPath', () => {
  it('maps every sidebar route', () => {
    expect(titleForPath('/')).toBe('Dashboard');
    expect(titleForPath('/net-worth')).toBe('Net Worth');
    expect(titleForPath('/investments')).toBe('Investments');
    expect(titleForPath('/loans')).toBe('Loans');
    expect(titleForPath('/property')).toBe('Property');
    expect(titleForPath('/vehicles')).toBe('Vehicles');
    expect(titleForPath('/equity-grants')).toBe('Equity Grants');
    expect(titleForPath('/spending')).toBe('Spending');
    expect(titleForPath('/spending/transactions')).toBe('Transactions');
    expect(titleForPath('/budget')).toBe('Budget');
    expect(titleForPath('/goals')).toBe('Goals');
    expect(titleForPath('/roadmap')).toBe('Roadmap');
    expect(titleForPath('/learn')).toBe('Learn');
    expect(titleForPath('/calculators')).toBe('Calculators');
    expect(titleForPath('/calculators/paycheck')).toBe('Paycheck calculator');
    expect(titleForPath('/calculators/backtest')).toBe('Historical Backtest');
    expect(titleForPath('/what-if')).toBe('What-If');
    expect(titleForPath('/settings')).toBe('Settings');
    expect(titleForPath('/monthly')).toBe('Monthly check-in');
    expect(titleForPath('/setup')).toBe('Setup');
    expect(titleForPath('/welcome')).toBe('Welcome');
  });
  it('maps inputs tabs with the section prefix', () => {
    expect(titleForPath('/inputs/accounts')).toBe('Inputs · Accounts');
    expect(titleForPath('/inputs/vehicle-leases')).toBe('Inputs · Vehicle Leases');
    expect(titleForPath('/inputs')).toBe('Inputs');
  });
  it('falls back: unknown leaf inherits the nearest known ancestor; unknown root is null', () => {
    expect(titleForPath('/inputs/some-future-tab')).toBe('Inputs');
    expect(titleForPath('/nope')).toBeNull();
    expect(titleForPath('/net-worth/')).toBe('Net Worth'); // trailing slash
  });
});

describe('documentTitleFor', () => {
  it('suffixes the app name and falls back to bare app name', () => {
    expect(documentTitleFor('/roadmap')).toBe('Roadmap · Cairn');
    expect(documentTitleFor('/nope')).toBe('Cairn');
  });
});
