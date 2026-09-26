import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import Plans529Card from '@/components/investments/Plans529Card';
import { dateFromLocalISO } from '@/lib/dates';
import { AccountType, ContributionSource, DependentType, SnapshotSource } from '@/types/enums';
import type { Account, AccountSnapshot, Contribution, Dependent } from '@/types/schema';

/**
 * v1.8.0 A-2′ (the re-scoped 529 site): the projection parsed the beneficiary's
 * DOB with `new Date('YYYY-MM-DD')` — UTC midnight — and read it with LOCAL
 * getters. West of UTC that instant is the previous local day, so a DOB on the
 * 1st read the prior month (a Jan-1 DOB the prior year) and the month count to
 * the 18th birthday ran one LOW. The card now parses the DOB at local midnight,
 * so every zone reads what a UTC-zone machine always read.
 *
 * Hand-computed fixture: today 2026-06-15 (the page's local-midnight Date, month
 * index 5); rate 0 → projected = PV + monthly × months; PV $10,000; YTD $600
 * over 6 elapsed months → $100/mo.
 *   DOB 2010-01-01 → 18th 2028-01 → (2028 − 2026) × 12 + (0 − 5) = 19 → $11,900
 *   DOB 2010-03-01 → 2028-03 → 24 − 3 = 21 → $12,100
 *   DOB 2009-12-31 → 2027-12 → 12 + 6 = 18 → $11,800
 *   DOB 2010-07-15 → 2028-07 → 24 + 1 = 25 → $12,500
 *   DOB 2012-02-29 → setFullYear(2030) normalizes to 2030-03-01 → 48 − 3 = 45 → $14,500
 */
const plan = {
  id: 10, householdId: 1, ownerPersonId: null, beneficiaryDependentId: 1, name: "Junior's NY 529",
  institution: null, type: AccountType.ACCOUNT_529, cryptoWalletAddress: null, autoFetchEnabled: false,
  excludedFromNetWorth: false, stateOfPlan: 'NY', accentColor: null,
} as unknown as Account;
const snap = { id: 1, accountId: 10, snapshotDate: '2026-04-01', totalValue: 10_000, source: SnapshotSource.MANUAL } as AccountSnapshot;
const ytd = { id: 1, accountId: 10, personId: null, date: '2026-02-01', amount: 600, source: ContributionSource.MANUAL } as Contribution;

function at18(dobIso: string): string {
  const junior = { id: 1, householdId: 1, name: 'Junior', dateOfBirth: dobIso, type: DependentType.CHILD } as Dependent;
  render(
    <Plans529Card
      plans={[plan]}
      dependentById={new Map([[1, junior]])}
      latestSnapByAccount={new Map([[10, snap]])}
      contributions={[ytd]}
      today={dateFromLocalISO('2026-06-15')}
      moderateRate={0}
    />,
  );
  const text = screen.getByTestId('plan529-at-18').textContent ?? '';
  cleanup();
  return text;
}

describe('v1.8.0 A-2′: Plans529Card parses the DOB on the LOCAL calendar', () => {
  const ORIGINAL_TZ = process.env.TZ;
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it('Los Angeles: a Jan-1 DOB is 19 months from its 18th birthday → $11,900 (the UTC parse read Dec 31, 2009: 18 → $11,800)', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(at18('2010-01-01')).toBe('$11,900 at 18 (future $)');
  });

  it('Pacific/Auckland: a Dec-31 DOB is 18 months from its 18th birthday → $11,800 (a UTC-noon parse reads Jan 1, 2010 there: 19 → $11,900)', () => {
    // Dec 31, 2009 → 18th Dec 2027 → (2027 − 2026) × 12 + (11 − 5) = 18. 2009-12-31T12:00Z is
    // Jan 1, 2010 01:00 NZDT → 18th Jan 2028 → 24 + (0 − 5) = 19. East of UTC the UTC-midnight
    // parse (Dec 31 13:00 NZDT) already agreed.
    process.env.TZ = 'Pacific/Auckland';
    expect(at18('2009-12-31')).toBe('$11,800 at 18 (future $)');
  });

  it('zone invariance: Los Angeles and Auckland read what UTC reads — 1st-of-month, month-end, mid-month and leap-day DOBs', () => {
    const dobs = ['2010-01-01', '2010-03-01', '2009-12-31', '2010-07-15', '2012-02-29'];
    const read = (tz: string) => {
      process.env.TZ = tz;
      return dobs.map(at18);
    };
    const utc = read('UTC');
    expect(utc).toEqual([
      '$11,900 at 18 (future $)',
      '$12,100 at 18 (future $)',
      '$11,800 at 18 (future $)',
      '$12,500 at 18 (future $)',
      '$14,500 at 18 (future $)',
    ]);
    expect(read('America/Los_Angeles')).toEqual(utc);
    expect(read('Pacific/Auckland')).toEqual(utc);
  });
});
