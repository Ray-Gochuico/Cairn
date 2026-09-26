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

describe('AccountBreakdownCard — one true minus (v1.7.1 M1)', () => {
  function renderRows(rs: AccountBreakdownRow[], t: AccountBreakdownTotal) {
    return render(
      <MemoryRouter>
        <AccountBreakdownCard
          rows={rs}
          total={t}
          colorByAccountId={new Map(rs.map((r, i) => [r.accountId, i === 0 ? '#123456' : '#654321']))}
          investableOnly={false}
          onToggleInvestableOnly={() => {}}
          asOfDate={null}
        />
      </MemoryRouter>,
    );
  }

  it('a down month reads "−$1,000(−10.0%)" in the row and the header — the percent carries the dollar\'s glyph', () => {
    const down: AccountBreakdownRow = { ...rows[0], currentValue: 9_000, valueAsOf: 10_000, changeAbs: -1_000, changePct: -0.1 };
    renderRows([down], { currentValue: 9_000, valueAsOf: 10_000, pctOfTotal: 1, changeAbs: -1_000, changePct: -0.1 });
    expect(screen.getByText('Brokerage').closest('li')!.textContent).toBe('Brokerage100% of portfolio$9,000−$1,000(−10.0%)');
    expect(document.body.textContent).toContain('vs last month−$1,000(−10.0%)');
  });

  it('D-M1-6: a negative account\'s share reads "−25% of portfolio" beside its "−$2,000"', () => {
    const up: AccountBreakdownRow = { ...rows[0], currentValue: 10_000, valueAsOf: 9_000, pctOfTotal: 1.25, changeAbs: 1_000, changePct: 0.111 };
    const neg: AccountBreakdownRow = {
      accountId: 2, name: 'Checking', type: AccountType.ACCOUNT_CASH,
      currentValue: -2_000, valueAsOf: 500, pctOfTotal: -0.25, changeAbs: -2_500, changePct: -5,
    };
    renderRows([up, neg], { currentValue: 8_000, valueAsOf: 9_500, pctOfTotal: 1, changeAbs: -1_500, changePct: -1_500 / 9_500 });
    expect(screen.getByText('Checking').closest('li')!.textContent).toBe('Checking−25% of portfolio−$2,000−$2,500(−500.0%)');
  });
});
