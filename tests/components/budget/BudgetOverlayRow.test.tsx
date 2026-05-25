import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BudgetOverlayRow from '@/components/budget/BudgetOverlayRow';
import type { BudgetRow } from '@/lib/budget-analysis';

const row = (over: Partial<BudgetRow> = {}): BudgetRow => ({
  categoryId: 1,
  categoryName: 'Groceries',
  parentCategoryId: null,
  budget: 600,
  actual: 200,
  remaining: 400,
  pct: 200 / 600,
  overBudget: false,
  ...over,
});

describe('BudgetOverlayRow', () => {
  describe('under-budget state (0 < actual <= budget)', () => {
    it('renders the category name and the "$X left" label in green', () => {
      render(<BudgetOverlayRow row={row()} />);
      expect(screen.getByText('Groceries')).toBeInTheDocument();
      const left = screen.getByText('$400 left');
      expect(left).toBeInTheDocument();
      // The "$X left" label should carry the under-budget (green) color class.
      expect(left.className).toMatch(/text-(green|emerald)-/);
    });

    it('renders an "$actual of $budget" caption below the bar', () => {
      render(<BudgetOverlayRow row={row()} />);
      expect(screen.getByText('$200 of $600')).toBeInTheDocument();
    });

    it('fills the bar proportionally with a green fill', () => {
      render(<BudgetOverlayRow row={row({ actual: 300, remaining: 300, pct: 0.5 })} />);
      const fill = screen.getByTestId('budget-overlay-fill');
      expect(fill).toHaveStyle({ width: '50%' });
      expect(fill.className).toMatch(/bg-(green|emerald)-/);
    });

    it('caps the fill at 100% when actual exactly equals budget', () => {
      render(<BudgetOverlayRow row={row({ actual: 600, remaining: 0, pct: 1 })} />);
      const fill = screen.getByTestId('budget-overlay-fill');
      expect(fill).toHaveStyle({ width: '100%' });
      expect(fill.className).toMatch(/bg-(green|emerald)-/);
    });
  });

  describe('over-budget state (actual > budget)', () => {
    it('renders the "$X over" label in red', () => {
      render(
        <BudgetOverlayRow
          row={row({ actual: 750, remaining: -150, pct: 1.25, overBudget: true })}
        />,
      );
      const over = screen.getByText('$150 over');
      expect(over).toBeInTheDocument();
      expect(over.className).toMatch(/text-(red|rose|pink)-/);
    });

    it('caps the fill at 100% width with a red fill', () => {
      render(
        <BudgetOverlayRow
          row={row({ actual: 750, remaining: -150, pct: 1.25, overBudget: true })}
        />,
      );
      const fill = screen.getByTestId('budget-overlay-fill');
      expect(fill).toHaveStyle({ width: '100%' });
      expect(fill.className).toMatch(/bg-(red|rose|pink)-/);
    });

    it('renders an "$actual of $budget" caption with the actual amount', () => {
      render(
        <BudgetOverlayRow
          row={row({ actual: 750, remaining: -150, pct: 1.25, overBudget: true })}
        />,
      );
      expect(screen.getByText('$750 of $600')).toBeInTheDocument();
    });
  });

  describe('empty state (actual = 0)', () => {
    it('renders the full $budget as remaining ("$X left") in muted color', () => {
      render(<BudgetOverlayRow row={row({ actual: 0, remaining: 600, pct: 0 })} />);
      expect(screen.getByText('$600 left')).toBeInTheDocument();
    });

    it('shows a grey/empty track with no visible fill', () => {
      render(<BudgetOverlayRow row={row({ actual: 0, remaining: 600, pct: 0 })} />);
      const fill = screen.getByTestId('budget-overlay-fill');
      expect(fill).toHaveStyle({ width: '0%' });
    });

    it('renders a "$0 of $budget" caption', () => {
      render(<BudgetOverlayRow row={row({ actual: 0, remaining: 600, pct: 0 })} />);
      expect(screen.getByText('$0 of $600')).toBeInTheDocument();
    });
  });

  describe('budget input', () => {
    it('renders a numeric input wired to the row\'s current budget', () => {
      render(<BudgetOverlayRow row={row()} />);
      const input = screen.getByLabelText(/budget for groceries/i) as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.value).toBe('600');
    });

    it('renders an empty input when budget is null (unbudgeted)', () => {
      render(
        <BudgetOverlayRow
          row={row({ budget: null, remaining: null, pct: null })}
        />,
      );
      const input = screen.getByLabelText(/budget for groceries/i) as HTMLInputElement;
      expect(input.value).toBe('');
    });
  });

  describe('unbudgeted row', () => {
    it('does not render an over/left label when budget is null', () => {
      render(
        <BudgetOverlayRow
          row={row({ budget: null, remaining: null, pct: null, actual: 50 })}
        />,
      );
      expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
      expect(screen.queryByText(/over$/)).not.toBeInTheDocument();
    });
  });
});
