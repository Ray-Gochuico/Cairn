import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import { DollarBasisToggle } from '@/components/calculators/DollarBasisToggle';
import { WHATIF_PAGE_ID, __resetDollarBasisForTests } from '@/lib/calculators/dollar-basis';

describe('DollarBasisToggle (W5 D-T1/m8)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  it("defaults to Today's $ with an aria-pressed pair (D-T3)", () => {
    render(<DollarBasisToggle />);
    expect(screen.getByRole('group', { name: 'Dollar basis' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Today's $" })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Future $' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('clicking Future $ flips aria state and persists under calc-basis:calculators', async () => {
    const user = userEvent.setup();
    render(<DollarBasisToggle />);
    await user.click(screen.getByRole('button', { name: 'Future $' }));
    expect(screen.getByRole('button', { name: 'Future $' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: "Today's $" })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(sessionStorage.getItem('calc-basis:calculators')).toBe('future');
  });

  it('names exactly what it governs (m8 scope label, C4)', () => {
    render(<DollarBasisToggle />);
    expect(screen.getByTestId('dollar-basis-scope-note').textContent).toBe(
      'Applies to Path to FI & Compound Interest',
    );
  });

  it('W5.1: pageId routes the write to THAT page; scopeNote null renders no note', async () => {
    const user = userEvent.setup();
    render(<DollarBasisToggle pageId={WHATIF_PAGE_ID} scopeNote={null} />);
    expect(screen.queryByTestId('dollar-basis-scope-note')).toBeNull();
    expect(screen.getByRole('group', { name: 'Dollar basis' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Future $' }));
    expect(sessionStorage.getItem('calc-basis:whatif')).toBe('future');
    expect(sessionStorage.getItem('calc-basis:calculators')).toBeNull();
  });

  it('defaults are byte-identical to the landed calculators control (no-prop render)', () => {
    render(<DollarBasisToggle />);
    expect(screen.getByTestId('dollar-basis-scope-note').textContent).toBe(
      'Applies to Path to FI & Compound Interest',
    );
  });
});
