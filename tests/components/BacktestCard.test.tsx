import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BacktestCard } from '@/pages/calculators/BacktestCard';

describe('BacktestCard', () => {
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

describe('BacktestCard waymark meaning (Wave 17)', () => {
  it('renders the static meaning line (no data claims)', () => {
    render(<MemoryRouter><BacktestCard cardId="backtest" /></MemoryRouter>);
    expect(screen.getByTestId('backtest-meaning')).toHaveTextContent(
      /replay historical market sequences against your current allocation\./i,
    );
  });
});
