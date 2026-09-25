import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ModelGapsCard } from '@/components/whatif/ModelGapsCard';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { ModelGapsInput } from '@/lib/model-gaps';
import { makeAccount, makeHousehold, makePerson } from '../../factories';
import { AccountType, ContributionSource, SnapshotSource } from '@/types/enums';
import type { AccountSnapshot, AppSettings, Contribution } from '@/types/schema';
import { ADVICE_LEXICON, RESERVED_PHRASES } from '../../helpers/advice-lexicon';

// The SETTLED fixture is kept in sync by hand with tests/lib/model-gaps.test.ts
// (the plan's note): account + a previous-month USER_CONFIRMED snapshot + a
// contribution inside the trailing 12 months, so every G-row condition fails.
const TODAY = '2026-08-25';

const confirmedSnapshot: AccountSnapshot = {
  id: 1, accountId: 3, snapshotDate: '2026-07-31', totalValue: 50_000,
  source: SnapshotSource.USER_CONFIRMED,
};
const recentContribution: Contribution = {
  id: 1, accountId: 3, personId: null, date: '2026-06-15', amount: 500,
  source: ContributionSource.MANUAL,
};

const input = (over: Partial<ModelGapsInput> = {}): ModelGapsInput => ({
  household: makeHousehold({
    monthlyExpenseBaseline: 6_000, withdrawalRate: 0.04, inflationAssumption: 0.03,
    growthScenarios: [{ label: 'Moderate', rate: 0.06 }],
  }),
  settings: { defaultDrawdownTaxRate: 0.15 } as AppSettings,
  persons: [makePerson({ id: 1, name: 'Alex', annualSalaryPretax: 120_000 })],
  accounts: [makeAccount({ id: 3, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' })],
  snapshots: [confirmedSnapshot],
  contributions: [recentContribution],
  roadmapHasUnanswered: false,
  engineStartsAtZero: true,
  scenarioSpending: [],
  sides: [{ name: 'Baseline', payload: emptyLeverPayload() }],
  todayIso: TODAY,
  ...over,
});

const renderCard = (over: Partial<ModelGapsInput> = {}) =>
  render(<MemoryRouter><ModelGapsCard input={input(over)} /></MemoryRouter>);

describe('ModelGapsCard', () => {
  it('zero rows → the card is ABSENT (calm outcome, D-W3-13)', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-testid="whatif-model-gaps-card"]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('rows render verbatim with their pinned links', () => {
    renderCard({ roadmapHasUnanswered: true });
    expect(screen.getByText("What the model doesn't know yet")).toBeInTheDocument();
    expect(screen.getByText("The roadmap has questions you haven't answered — its checklist and frameworks assume less until you do.")).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open Roadmap →' });
    expect(link).toHaveAttribute('href', '/roadmap');
  });

  it('several rows render in the model order, each with its own home link', () => {
    const { container } = renderCard({ snapshots: [], contributions: [] });
    const items = Array.from(container.querySelectorAll('li'));
    expect(items.map((li) => li.querySelector('span')?.textContent)).toEqual([
      'No account snapshots yet — the portfolio starts at $0 in these projections.',
      "Last month's balances aren't confirmed — lines start from the latest figures you've confirmed.",
      "No contributions in the last 12 months — the projection assumes none beyond the scenario's contribution levers.",
    ]);
    expect(items.map((li) => li.querySelector('a')?.getAttribute('href'))).toEqual([
      '/investments?manage=accounts',
      '/monthly',
      '/investments?manage=contributions',
    ]);
  });

  it('no clamped rows; labelled section', () => {
    const { container } = renderCard({ roadmapHasUnanswered: true });
    expect(container.innerHTML).not.toMatch(/line-clamp|truncate/);
    expect(container.querySelector('section[aria-labelledby="model-gaps-heading"]')).not.toBeNull();
    expect(container.querySelector('#model-gaps-heading')?.textContent).toBe("What the model doesn't know yet");
  });

  it('carries no advice verb, reserved phrase, or exclamation mark', () => {
    const { container } = renderCard({
      snapshots: [], contributions: [], roadmapHasUnanswered: true,
      household: makeHousehold({ monthlyExpenseBaseline: 0, withdrawalRate: 0, inflationAssumption: 0.03, growthScenarios: [] }),
    });
    const text = container.textContent ?? '';
    // Review MINOR 0: one shared lexicon, so the three W3 files stop drifting.
    expect(text).not.toMatch(ADVICE_LEXICON);
    for (const phrase of RESERVED_PHRASES) expect(text).not.toContain(phrase);
    expect(text).not.toContain('!');
  });

  it('C2: a G11 row renders its in-page action as a BUTTON when the page supplies the handler; clicking hands it the scenario + lever', () => {
    const onOpenLever = vi.fn();
    render(<MemoryRouter><ModelGapsCard input={input({ scenarioSpending: [{ scenarioId: 3, name: 'Baseline', authorsSpending: false, spendsAnything: false }] })} onOpenLever={onOpenLever} /></MemoryRouter>);
    expect(screen.getByText("Baseline's expense base is $0 — the projection assumes nothing is spent, so no FI date is shown.")).toBeInTheDocument();
    const action = screen.getByRole('button', { name: 'Open Expenses →' });
    expect(screen.queryByRole('link', { name: 'Open Expenses →' })).toBeNull();
    fireEvent.click(action);
    expect(onOpenLever).toHaveBeenCalledWith(3, 'expenses');
  });

  it('C2: without a handler the row states its fact and renders NO control (never a dead button)', () => {
    render(<MemoryRouter><ModelGapsCard input={input({ scenarioSpending: [{ scenarioId: 3, name: 'Baseline', authorsSpending: false, spendsAnything: false }] })} /></MemoryRouter>);
    expect(screen.getByText(/Baseline's expense base is \$0/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Expenses →' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Expenses →' })).toBeNull();
  });

  it('C2 review: BOTH G11 variants carry the basis-registry testid (their $0 is registered invariant on the page)', () => {
    render(<MemoryRouter><ModelGapsCard input={input({ scenarioSpending: [
      { scenarioId: 3, name: 'Baseline', authorsSpending: false, spendsAnything: false },
      { scenarioId: 4, name: 'Renting', authorsSpending: false, spendsAnything: true },
    ] })} onOpenLever={vi.fn()} /></MemoryRouter>);
    expect(screen.getAllByTestId('whatif-model-gap-expense-base').map((el) => el.textContent)).toEqual([
      "Baseline's expense base is $0 — the projection assumes nothing is spent, so no FI date is shown.",
      "Renting's expense base is $0 — the projection counts only rent and vehicle leases as spending, so no FI date is shown.",
    ]);
  });

  it('A-13: the G2 row carries the basis-registry testid, once (its $0 is registered invariant on the page); the route rows beside it carry none', () => {
    const { container } = renderCard({ snapshots: [], contributions: [] }); // G2 + G3 + G4 (the "several rows" fixture above)
    expect(screen.getByTestId('whatif-model-gap-portfolio-zero').textContent).toBe(
      'No account snapshots yet — the portfolio starts at $0 in these projections.',
    );
    expect(container.querySelectorAll('[data-testid="whatif-model-gap-portfolio-zero"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="whatif-model-gap-expense-base"]')).toHaveLength(0);
  });
});
