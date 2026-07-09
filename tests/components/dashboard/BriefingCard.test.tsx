import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BriefingCard } from '@/components/dashboard/BriefingCard';
import type { Briefing } from '@/lib/briefing';

const sampleBriefing: Briefing = {
  rows: [
    {
      id: 'net-worth',
      parts: [
        { text: 'Net worth is up ' },
        { text: '+$18,000 (+8.7%)', emphasis: true },
        { text: '.' },
      ],
      tone: 'positive',
      materiality: 18_000,
      href: '/net-worth',
      linkLabel: 'See net worth',
      householdScoped: false,
    },
    {
      id: 'concentration',
      parts: [
        { text: 'BND is 17.7% of your effective exposure', emphasis: true },
        { text: '. Note — not a warning.' },
      ],
      tone: 'note',
      materiality: 0.177,
      href: '/investments#concentration',
      linkLabel: 'See breakdown',
      householdScoped: true,
    },
  ],
  empty: null,
};

function renderCard(props: Partial<Parameters<typeof BriefingCard>[0]> = {}) {
  return render(
    <MemoryRouter>
      <BriefingCard heading="Since your last visit" briefing={sampleBriefing} viewFiltered={false} {...props} />
    </MemoryRouter>,
  );
}

describe('BriefingCard', () => {
  it('is a region named by the heading, with each row a link to its source page', () => {
    renderCard();
    expect(screen.getByRole('region', { name: 'Since your last visit' })).toBeInTheDocument();
    const nw = screen.getByRole('link', { name: /net worth is up \+\$18,000 \(\+8\.7%\)\./i });
    expect(nw).toHaveAttribute('href', '/net-worth');
    expect(
      screen.getByRole('link', { name: /BND is 17\.7% of your effective exposure\. Note — not a warning\./i }),
    ).toHaveAttribute('href', '/investments#concentration');
  });

  it('renders the fallback heading text when in last-month mode', () => {
    renderCard({ heading: 'Since June' });
    expect(screen.getByRole('region', { name: 'Since June' })).toBeInTheDocument();
  });

  it('appends "· Household" ONLY to household-scoped rows, ONLY under a person view', () => {
    const { unmount } = renderCard({ viewFiltered: true });
    const scoped = screen.getByTestId('briefing-row-concentration');
    expect(scoped).toHaveTextContent('· Household');
    expect(screen.getByTestId('briefing-row-net-worth')).not.toHaveTextContent('· Household');
    unmount();
    renderCard({ viewFiltered: false });
    expect(screen.getByTestId('briefing-row-concentration')).not.toHaveTextContent('· Household');
  });

  it('renders the honest empty state as calm copy (NOT an onboarding EmptyState)', () => {
    renderCard({
      briefing: { rows: [], empty: { title: 'Nothing needs your attention.', detail: 'Net worth is holding steady.' } },
    });
    expect(screen.getByText('Nothing needs your attention.')).toBeInTheDocument();
    expect(screen.getByText('Net worth is holding steady.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('omits the steady detail when nothing was measured', () => {
    renderCard({
      briefing: { rows: [], empty: { title: 'Nothing needs your attention.', detail: null } },
    });
    expect(screen.queryByText('Net worth is holding steady.')).toBeNull();
  });

  it('never paints a destructive token — a dip must not look like an error (calm ethos)', () => {
    const { container } = renderCard({
      briefing: {
        rows: [
          {
            id: 'net-worth',
            parts: [{ text: 'Net worth is down ' }, { text: '-$12,000 (-0.6%)', emphasis: true }, { text: '.' }],
            tone: 'neutral',
            materiality: 12_000,
            href: '/net-worth',
            linkLabel: 'See net worth',
            householdScoped: false,
          },
        ],
        empty: null,
      },
    });
    expect(container.querySelector('[class*="destructive"]')).toBeNull();
    expect(container.querySelector('[class*="warning"]')).toBeNull();
  });

  it('has no aria-live region (decision: no auto-announcement of a financial digest)', () => {
    const { container } = renderCard();
    expect(container.querySelector('[aria-live]')).toBeNull();
  });
});
