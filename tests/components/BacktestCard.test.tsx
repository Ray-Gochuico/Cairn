import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BacktestCard } from '@/pages/calculators/BacktestCard';
import { usePersonsStore } from '@/stores/persons-store';
import { writeLastBacktestRun } from '@/lib/backtest/last-run';
import { makePerson } from '../factories';

describe('BacktestCard', () => {
  beforeEach(() => localStorage.clear());

  it('renders the card title', () => {
    render(
      <MemoryRouter>
        <BacktestCard />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /Historical Backtest/i })).toBeInTheDocument();
  });

  it('renders a link to /calculators/backtest', () => {
    render(
      <MemoryRouter>
        <BacktestCard />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /open the historical backtest tool/i });
    expect(link).toHaveAttribute('href', '/calculators/backtest');
  });

  it('forwards cardId so the card shell mounts with its stable testid (Wave 17)', () => {
    render(
      <MemoryRouter>
        <BacktestCard cardId="backtest" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('calc-card-backtest')).toBeInTheDocument();
  });
});

describe('BacktestCard verdict waymark (Wave 18 C9 / D3)', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  const record = {
    v: 1,
    runAt: '2026-07-18T15:00:00.000Z',
    goalMetCount: 108,
    startYearsCount: 124,
    survivedCount: 120,
    config: {},
  };

  it('no last run → the honest imperative headline, no meaning claims', () => {
    render(<MemoryRouter><BacktestCard cardId="backtest" /></MemoryRouter>);
    expect(screen.getByTestId('backtest-headline')).toHaveTextContent(
      'Backtest your portfolio',
    );
    expect(screen.getByTestId('backtest-meaning')).not.toHaveTextContent(/last run/i);
  });

  it('a stored last run → the "N% of M" verdict + "last run {date}" meaning', () => {
    // v1.8.0 A-2′: the card shows the LOCAL day of the instant, so the zone is pinned
    // (15:00Z = 11:00 EDT Jul 18); no one instant is Jul 18 from UTC−12 to UTC+14.
    process.env.TZ = 'America/New_York';
    localStorage.setItem('backtest:last-run:v1', JSON.stringify(record));
    render(<MemoryRouter><BacktestCard cardId="backtest" /></MemoryRouter>);
    // 108 / 124 = 87.09…% → rounds to 87.
    expect(screen.getByTestId('backtest-verdict')).toHaveTextContent('87% of 124');
    expect(screen.getByTestId('backtest-meaning')).toHaveTextContent(/last run/i);
    expect(screen.getByTestId('backtest-meaning')).toHaveTextContent(/Jul 18, 2026/);
  });

  it('a malformed stored record fails soft to the imperative headline', () => {
    localStorage.setItem('backtest:last-run:v1', '{broken');
    render(<MemoryRouter><BacktestCard cardId="backtest" /></MemoryRouter>);
    expect(screen.getByTestId('backtest-headline')).toHaveTextContent(
      'Backtest your portfolio',
    );
  });
});

describe('BacktestCard waymark meaning (Wave 17)', () => {
  beforeEach(() => localStorage.clear());

  it('renders the imperative headline with no stored run (Wave 18: meaning carries no data claims)', () => {
    render(<MemoryRouter><BacktestCard cardId="backtest" /></MemoryRouter>);
    expect(screen.getByTestId('backtest-headline')).toHaveTextContent(
      /backtest your portfolio/i,
    );
  });

  it('Wave C N3: pre-first-run rest card carries the CW20 invite, no data claims', () => {
    localStorage.clear(); // no last-run record
    render(<MemoryRouter><BacktestCard cardId="backtest" /></MemoryRouter>);
    expect(screen.getByTestId('backtest-meaning')).toHaveTextContent(
      'Replay 150+ years of markets against your allocation.',
    );
  });
});

describe('BacktestCard — scope tag (Wave B CB23 / D-B14)', () => {
  const record = {
    v: 1 as const,
    runAt: '2026-07-18T15:00:00.000Z',
    goalMetCount: 108,
    startYearsCount: 124,
    survivedCount: 120,
    config: {},
  };

  function primeTwoPersons() {
    usePersonsStore.setState({
      persons: [
        makePerson({ id: 1, name: 'Demo Investor' }),
        makePerson({ id: 2, name: 'Demo Partner' }),
      ],
      isLoading: false,
      error: null,
    } as never);
  }

  beforeEach(() => {
    localStorage.clear();
    usePersonsStore.setState({ persons: [], isLoading: false, error: null } as never);
  });

  it("Wave B CB23: a 2-person household sees the run's scope tag in the meaning", () => {
    primeTwoPersons();
    writeLastBacktestRun({ ...record, scopeLabel: 'Demo Partner' });
    render(<MemoryRouter><BacktestCard cardId="backtest" /></MemoryRouter>);
    expect(screen.getByTestId('backtest-meaning')).toHaveTextContent('· Demo Partner run');
  });

  it('Wave B CB23: a legacy record reads as a Household run', () => {
    primeTwoPersons();
    localStorage.setItem('backtest:last-run:v1', JSON.stringify(record));
    render(<MemoryRouter><BacktestCard cardId="backtest" /></MemoryRouter>);
    expect(screen.getByTestId('backtest-meaning')).toHaveTextContent('· Household run');
  });

  it('Wave B CB23: a single-person household never shows the tag', () => {
    usePersonsStore.setState({
      persons: [makePerson({ id: 1, name: 'Demo Investor' })],
      isLoading: false,
      error: null,
    } as never);
    writeLastBacktestRun({ ...record, scopeLabel: 'Household' });
    render(<MemoryRouter><BacktestCard cardId="backtest" /></MemoryRouter>);
    expect(screen.getByTestId('backtest-meaning')).not.toHaveTextContent('· Household run');
  });
});

describe('v1.8.0 A-2′: "last run" names the LOCAL calendar day of the run instant', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  const storeRunAt = (runAt: string) =>
    localStorage.setItem(
      'backtest:last-run:v1',
      JSON.stringify({ v: 1, runAt, goalMetCount: 108, startYearsCount: 124, survivedCount: 120, config: {} }),
    );

  it('Los Angeles: a run at 2026-01-01T03:00Z (Dec 31, 19:00 PST) reads "last run Dec 31, 2025" — not the UTC day', () => {
    process.env.TZ = 'America/Los_Angeles';
    storeRunAt('2026-01-01T03:00:00.000Z');
    render(<MemoryRouter><BacktestCard cardId="backtest" /></MemoryRouter>);
    expect(screen.getByTestId('backtest-meaning').textContent).toBe(
      'start years since 1871 sustained this plan · last run Dec 31, 2025',
    );
  });

  it('Pacific/Auckland: a run at 2025-12-31T20:00Z (Jan 1, 09:00 NZDT) reads "last run Jan 1, 2026"', () => {
    process.env.TZ = 'Pacific/Auckland';
    storeRunAt('2025-12-31T20:00:00.000Z');
    render(<MemoryRouter><BacktestCard cardId="backtest" /></MemoryRouter>);
    expect(screen.getByTestId('backtest-meaning').textContent).toBe(
      'start years since 1871 sustained this plan · last run Jan 1, 2026',
    );
  });
});
