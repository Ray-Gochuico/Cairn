/**
 * A-7(2) (v1.7.1): a cold deep link to /calculators/backtest must not decide
 * the backtest gate before the household (and so the acceptances projection)
 * has loaded. AppDisclaimerGate renders its children while the household is
 * null, so the page used to mount the page-blocking DisclosureModal against an
 * EMPTY acceptances map (no box), then grow the what-changed box when a prior
 * row landed: a no-box → box flash. REAL household + acceptances stores and the
 * REAL gate here (the sibling Backtest tests mock all three). Separate file
 * because those mocks are file-scoped.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('recharts', () => {
  const passthrough =
    (testId: string) =>
    ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': testId }, children);
  return {
    ResponsiveContainer: passthrough('rc-responsive'),
    LineChart: passthrough('rc-linechart'),
    ComposedChart: passthrough('rc-composed'),
    BarChart: passthrough('rc-barchart'),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ReferenceLine: () => null,
    Line: () => null,
    Area: () => null,
    Bar: () => null,
    Cell: () => null,
  };
});

vi.mock('@/components/whatif/useRealState', () => ({
  useRealState: () => ({
    accounts: [], holdings: [], loans: [], loanPayments: [],
    household: { id: 1, filingStatus: 'SINGLE' }, persons: [],
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 0, initialInvestmentsByAccount: { 1: 1_000_000 }, cashAccountsWithBalances: [],
    defaults: { inflation: 0, returnRate: 0, defaultCashApy: null, defaultDrawdownTaxRate: null },
    startISO: '2026-01',
    taxBrackets: { federal: [], state: [], city: null, ltcg: [], standardDeduction: { federal: 0, state: 0, city: 0 } },
    housingPayments: [], vehicleLeases: [],
  }),
}));

import Backtest from '@/pages/calculators/Backtest';
import { useHouseholdStore } from '@/stores/household-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import { makeHousehold } from '../factories';
import { DISCLOSURE_VERSIONS } from '../helpers/disclosure-versions';

const BOX = 'What changed since you last accepted:';
const renderPage = () => render(<MemoryRouter><Backtest /></MemoryRouter>);

/** The cold-boot state a deep link mounts in: household null, projection still loading. */
function seedColdBoot() {
  useHouseholdStore.setState({ household: null, isLoading: true, error: null, load: async () => {} } as never);
  useAcceptancesStore.setState({ acceptedVersions: {}, status: 'loading', isLoading: true, error: null, load: async () => {} } as never);
}
/** The household and the projection land together (the order AppDisclaimerGate guarantees its children). */
function hydrate(acceptedVersions: Record<string, string>) {
  act(() => {
    useHouseholdStore.setState({ household: makeHousehold(), isLoading: false } as never);
    useAcceptancesStore.setState({ acceptedVersions, status: 'ready', isLoading: false } as never);
  });
}

describe('Backtest page — the gate waits for the household (A-7(2))', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetScenarioAssumptionsForTests();
    const noop = async () => {};
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: noop } as never);
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: noop } as never);
    seedColdBoot();
  });

  it('cold boot (household null, projection loading, empty map): no page-blocking modal, the route skeleton instead', () => {
    renderPage();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('disclosure-modal-body')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading page' })).toBeInTheDocument();
    expect(screen.queryByTestId('backtest-page')).toBeNull();
  });

  it('then an EARLIER acceptance lands: the modal first paints WITH its what-changed box (no no-box → box flash)', () => {
    renderPage();
    expect(screen.queryByRole('dialog')).toBeNull();
    hydrate({ app_wide: DISCLOSURE_VERSIONS.app_wide, backtest: '1.4' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(`Version ${DISCLOSURE_VERSIONS.backtest}`)).toBeInTheDocument();
    expect(screen.getByText(BOX)).toBeInTheDocument();
  });

  it('then the CURRENT acceptance lands: the page renders and no modal ever mounted', () => {
    renderPage();
    expect(screen.queryByRole('dialog')).toBeNull();
    hydrate({ app_wide: DISCLOSURE_VERSIONS.app_wide, backtest: DISCLOSURE_VERSIONS.backtest });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('backtest-page')).toBeInTheDocument();
  });

  it('then no backtest row lands (never accepted): the modal without the box (R3, D-R3-2)', () => {
    renderPage();
    hydrate({ app_wide: DISCLOSURE_VERSIONS.app_wide });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText(BOX)).toBeNull();
  });

  it('a later transient acceptances re-load (status back to loading, rows kept) does not hide the page', () => {
    renderPage();
    hydrate({ app_wide: DISCLOSURE_VERSIONS.app_wide, backtest: DISCLOSURE_VERSIONS.backtest });
    act(() => {
      useAcceptancesStore.setState({ status: 'loading', isLoading: true } as never);
    });
    expect(screen.getByTestId('backtest-page')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading page' })).toBeNull();
  });
});
