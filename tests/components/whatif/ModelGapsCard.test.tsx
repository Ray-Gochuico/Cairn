import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ModelGapsCard } from '@/components/whatif/ModelGapsCard';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { ModelGapsInput } from '@/lib/model-gaps';
import { makeAccount, makeHousehold, makePerson } from '../../factories';
import { AccountType, ContributionSource, SnapshotSource } from '@/types/enums';
import type { AccountSnapshot, AppSettings, Contribution } from '@/types/schema';

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
      'No contributions in the last 12 months — ongoing contributions enter these prefills as $0.',
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
    expect(text).not.toMatch(/\b(should|recommend|consider|suggest|advise|winner)\b/i);
    expect(text).not.toContain('Suggested next step');
    expect(text).not.toContain('Note — not a warning.');
    expect(text).not.toContain('!');
  });
});
