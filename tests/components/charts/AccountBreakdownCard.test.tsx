import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AccountBreakdownCard from '@/components/charts/AccountBreakdownCard';
import { formatDate } from '@/lib/format';
import { AccountType } from '@/types/enums';
import type {
  AccountBreakdownRow,
  AccountBreakdownTotal,
} from '@/lib/account-breakdown';

const rows: AccountBreakdownRow[] = [
  {
    accountId: 1,
    name: 'Brokerage',
    type: AccountType.ACCOUNT_BROKERAGE,
    currentValue: 10000,
    valueAsOf: 9000,
    pctOfTotal: 1,
    changeAbs: 1000,
    changePct: 0.111,
  },
];

const total: AccountBreakdownTotal = {
  currentValue: 10000,
  valueAsOf: 9000,
  pctOfTotal: 1,
  changeAbs: 1000,
  changePct: 0.111,
};

function renderCard(asOfDate: string | null) {
  return render(
    <MemoryRouter>
      <AccountBreakdownCard
        rows={rows}
        total={total}
        colorByAccountId={new Map([[1, '#123456']])}
        investableOnly={false}
        onToggleInvestableOnly={() => {}}
        asOfDate={asOfDate}
      />
    </MemoryRouter>,
  );
}

describe('AccountBreakdownCard "as of" line (Wave-11 T4 miss)', () => {
  it('humanizes the "as of" date and never renders the raw ISO string', () => {
    renderCard('2026-07-08');
    // Humanized 'Jul 8, 2026', never the raw ISO '2026-07-08'.
    expect(screen.getByText(`as of ${formatDate('2026-07-08')}`)).toBeInTheDocument();
    expect(screen.getByText('as of Jul 8, 2026')).toBeInTheDocument();
    expect(screen.queryByText(/2026-07-08/)).toBeNull();
  });

  it('omits the "as of" line entirely when there is no snapshot date', () => {
    renderCard(null);
    expect(screen.queryByText(/as of/)).toBeNull();
  });
});
