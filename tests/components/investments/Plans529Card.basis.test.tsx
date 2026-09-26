import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectBasisDiscipline } from '../../helpers/basis-discipline';
import Plans529Card, { PLANS_529_BASIS_FIGURES } from '@/components/investments/Plans529Card';
import { __resetDollarBasisForTests } from '@/lib/calculators/dollar-basis';
import { AccountType, DependentType, SnapshotSource } from '@/types/enums';
import type { Account, AccountSnapshot, Dependent } from '@/types/schema';

// DOB 2018-05-15, today 2026-05-14 → 18th birthday 2036-05-15 → 120 months ; r = 0.005 ;
// PV 25,000 ; no contributions.
//   projected = 25,000·1.005^120 = 45,484.92 → $45,485   (real anti-pin ÷1.03^10 = $33,845)
const TODAY = new Date('2026-05-14T12:00:00Z');
const plan = {
  id: 10, householdId: 1, ownerPersonId: null, beneficiaryDependentId: 1, name: "Junior's NY 529",
  institution: null, type: AccountType.ACCOUNT_529, cryptoWalletAddress: null, autoFetchEnabled: false,
  excludedFromNetWorth: false, stateOfPlan: 'NY', accentColor: null,
} as unknown as Account;
const junior = { id: 1, householdId: 1, name: 'Junior', dateOfBirth: '2018-05-15', type: DependentType.CHILD } as Dependent;
const snap = { id: 1, accountId: 10, snapshotDate: '2026-04-01', totalValue: 25_000, source: SnapshotSource.MANUAL } as AccountSnapshot;
const card = () => (
  <Plans529Card
    plans={[plan]}
    dependentById={new Map([[1, junior]])}
    latestSnapByAccount={new Map([[10, snap]])}
    contributions={[]}
    today={TODAY}
    moderateRate={0.06}
  />
);

describe('W5.1 529 — projected-at-18 is a PINNED future-dollar figure (F8)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  it('ANCHOR: $45,485 at 18 (future $); now/YTD unmarked year-0 figures; the deflated $33,845 never renders', () => {
    const { container } = render(card());
    expect(screen.getByTestId('plan529-at-18').textContent).toBe('$45,485 at 18 (future $)');
    expect(screen.getByTestId('plan529-now').textContent).toBe('$25,000 now');
    expect(screen.getByTestId('plan529-ytd').textContent).toBe('$0 YTD');
    expect(container.textContent).toContain('Projected values are in future dollars — not adjusted for inflation.');
    expect(container.textContent).not.toContain('$33,845');
  });

  // v1.7.1 A-5a (CP5-2): the suffix moved onto FUTURE_SUFFIX through ONE template
  // literal, so the row's DOM is byte-identical, not merely text-equal (the
  // textContent pin above cannot tell one text node from two).
  it('CP5-2 (v1.7.1 A-5a): the at-18 suffix renders as ONE text node', () => {
    render(card());
    const suffix = screen.getByTestId('plan529-at-18').querySelector('span')!;
    expect(suffix.childNodes).toHaveLength(1);
    expect(suffix.textContent).toBe('at 18 (future $)');
  });

  it('sweep: pinned-future + invariant rows; no unregistered $', () => {
    expectBasisDiscipline(card(), { figures: PLANS_529_BASIS_FIGURES, charts: [] });
  });
});
