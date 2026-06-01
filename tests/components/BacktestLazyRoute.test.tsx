import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Backtest from '@/pages/calculators/Backtest';

describe('BacktestLazyRoute (page stub)', () => {
  it('mounts at /calculators/backtest and renders the page heading', () => {
    render(
      <MemoryRouter initialEntries={['/calculators/backtest']}>
        <Routes>
          <Route path="/calculators/backtest" element={<Backtest />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /historical backtest/i })).toBeInTheDocument();
  });

  it('renders a placeholder / coming-soon indicator', () => {
    render(
      <MemoryRouter>
        <Backtest />
      </MemoryRouter>,
    );
    // The stub should indicate more content is coming
    expect(screen.getByTestId('backtest-stub')).toBeInTheDocument();
  });
});
