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
    expect(screen.getByText(/Historical Backtest/i)).toBeInTheDocument();
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

  it('forwards cardId + onHide so the Hide button appears on the card', () => {
    const onHide = () => {};
    render(
      <MemoryRouter>
        <BacktestCard cardId="backtest" onHide={onHide} />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('button', { name: /hide historical backtest card/i }),
    ).toBeInTheDocument();
  });
});
