import { render, screen, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ScenarioBar } from '@/pages/calculators/ScenarioBar';
import { CompoundInterestCard } from '@/pages/calculators/CompoundInterestCard';
import {
  CALCULATORS_PAGE_ID,
  __resetDollarBasisForTests,
  useDollarBasisStore,
} from '@/lib/calculators/dollar-basis';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import { SCENARIO_STORAGE_KEY } from '@/lib/calculators/scenario-assumptions';
import { syncCalcScope, __resetCalcScopeForTests } from '@/lib/calculators/calc-view-scope';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { makePerson } from '../../factories';
import { AccountType } from '@/types/enums';
import type { Account, AppSettings } from '@/types/schema';

function mkAccount(id: number, type: AccountType = AccountType.ACCOUNT_BROKERAGE): Account {
  return {
    id,
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name: `Acct ${id}`,
    institution: null,
    type,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    stateOfPlan: null,
    accentColor: null,
  } as unknown as Account;
}

/** CompoundInterestCard.test.tsx's seedDemoScenario (pv 1000, pmt 100/mo, 7%). */
function seedDemoScenario() {
  sessionStorage.setItem(
    SCENARIO_STORAGE_KEY,
    JSON.stringify({ portfolio: 1000, annualContribution: 1200, returnPct: 7 }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ScenarioBar />
      <CompoundInterestCard />
    </MemoryRouter>,
  );
}

describe('W5 page integration: one control, page-wide effect, session semantics', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetScenarioAssumptionsForTests();
    __resetCalcScopeForTests();
    __resetDollarBasisForTests();
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useContributionsStore.setState({ contributions: [], isLoading: false, error: null } as never);
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null } as never);
    useTaxRulesStore.setState({ year: 2026, items: [], isLoading: false, error: null } as never);
    useSettingsStore.setState({
      settings: { defaultInflation: 0.025 } as AppSettings,
      isLoading: false,
      error: null,
    });
    seedDemoScenario();
  });

  it("fresh session: Today's $ everywhere by default (D-T3/D-T8)", () => {
    renderPage();
    expect(screen.getByRole('button', { name: "Today's $" })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('compound-headline').textContent).toContain("in today's dollars");
  });

  it('clicking the BAR control flips the CARD (the one-store wire)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Future $' }));
    expect(screen.getByTestId('compound-headline').textContent).toContain('in future dollars');
    expect(sessionStorage.getItem('calc-basis:calculators')).toBe('future');
  });

  it('a NEW session resets to Today (D-T8: no durable preference)', async () => {
    const user = userEvent.setup();
    const first = renderPage();
    await user.click(screen.getByRole('button', { name: 'Future $' }));
    first.unmount();
    // Simulate the cold boot: session storage gone, in-memory store gone.
    sessionStorage.clear();
    __resetDollarBasisForTests();
    __resetScenarioAssumptionsForTests();
    seedDemoScenario();
    renderPage();
    expect(screen.getByRole('button', { name: "Today's $" })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('same-session remount (client-side nav) KEEPS the basis', async () => {
    const user = userEvent.setup();
    const first = renderPage();
    await user.click(screen.getByRole('button', { name: 'Future $' }));
    first.unmount();
    __resetDollarBasisForTests(); // in-memory gone; sessionStorage survives the nav
    renderPage();
    expect(screen.getByRole('button', { name: 'Future $' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('person-scope flips leave the basis untouched (orthogonality pin)', () => {
    // Person-scope fixture copied from CompoundInterestCard.test.tsx's Wave B
    // CB14 test: Bob owns account 2 ($40k); account 3 is joint ($8k).
    usePersonsStore.setState({
      persons: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
      isLoading: false,
      error: null,
    } as never);
    useAccountsStore.setState({
      accounts: [{ ...mkAccount(2), ownerPersonId: 2 }, mkAccount(3)],
      isLoading: false,
      error: null,
    });
    useSnapshotsStore.setState({
      snapshots: [
        { id: 1, accountId: 2, snapshotDate: '2026-07-01', totalValue: 40_000, source: 'MANUAL', notes: null },
        { id: 2, accountId: 3, snapshotDate: '2026-07-01', totalValue: 8_000, source: 'MANUAL', notes: null },
      ],
      isLoading: false,
      error: null,
    } as never);
    sessionStorage.removeItem(SCENARIO_STORAGE_KEY);
    __resetScenarioAssumptionsForTests();

    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    render(
      <MemoryRouter>
        <ScenarioBar />
        <CompoundInterestCard cardId="compound-interest" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('compound-interest-meaning')).toHaveTextContent('$48,000 at');

    // Flip the person scope the way the card suite does, then re-render scoped.
    cleanup();
    syncCalcScope(2);
    __resetScenarioAssumptionsForTests();
    render(
      <MemoryRouter initialEntries={['/calculators?view=p2']}>
        <ScenarioBar />
        <CompoundInterestCard cardId="compound-interest" />
      </MemoryRouter>,
    );
    // The scope moved the ASSUMPTION inputs...
    expect(screen.getByTestId('compound-interest-meaning')).toHaveTextContent(
      "$40,000 in Bob's accounts at",
    );
    // ...and left the display BASIS exactly where it was (orthogonal lenses).
    expect(useDollarBasisStore.getState().byPage[CALCULATORS_PAGE_ID]).toBe('future');
    expect(screen.getByRole('button', { name: 'Future $' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('compound-headline').textContent).toContain('in future dollars');
  });
});
