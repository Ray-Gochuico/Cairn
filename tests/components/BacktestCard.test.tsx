import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BacktestCard } from '@/pages/calculators/BacktestCard';

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
  beforeEach(() => localStorage.clear());

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
});
