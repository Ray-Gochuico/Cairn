import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Roadmap from '@/pages/Roadmap';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useLoansStore } from '@/stores/loans-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import type { Household } from '@/types/schema';
import { makeHousehold } from '../factories';

// Roadmap document is still on v1.0; app_wide bumped to v1.1 in
// 2026-05-27 to add UCC § 2-316 / US-only / governing-law clauses,
// then to v1.2 to replace the [PLACEHOLDER] string in the governing-
// law clause with "the State of New York", then to v1.3 to add the
// "What this app does NOT model" section.
const ACCEPTED_VERSION = '1.0';


// The roadmap gate reads the acceptances projection (single source of truth,
// MF-1), not a household column. `roadmapAccepted` seeds that projection:
// undefined → no `roadmap` row → gate fires; a version → gate ready when it
// matches DISCLOSURES.roadmap.version.
function resetStores(household: Household | null, roadmapAccepted?: string) {
  useHouseholdStore.setState({
    household,
    isLoading: false,
    error: null,
    load: async () => {},
    update: async () => {},
    acceptDisclaimer: async () => {},
  } as any);
  useAcceptancesStore.setState({
    acceptedVersions: roadmapAccepted ? { roadmap: roadmapAccepted } : {},
    status: 'ready',
    isLoading: false,
    error: null,
    load: async () => {},
  } as any);
  usePersonsStore.setState({ persons: [], isLoading: false, error: null, load: async () => {} } as any);
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} } as any);
  useLoansStore.setState({ loans: [], isLoading: false, error: null, load: async () => {} } as any);
  useContributionsStore.setState({ contributions: [], isLoading: false, error: null, load: async () => {} } as any);
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: async () => {} } as any);
  useTransactionsStore.setState({ transactions: [], isLoading: false, error: null, load: async () => {} } as any);
  useRoadmapOverridesStore.setState({
    overridesByNodeId: new Map(),
    isLoading: false,
    error: null,
    load: async () => {},
    setOverride: async () => {},
    clearOverride: async () => {},
  } as any);
}

describe('Roadmap page', () => {
  beforeEach(() => {
    resetStores(makeHousehold());
  });

  it('renders the roadmap disclosure modal when the gate is needs-acceptance', () => {
    // No roadmap acceptance in the projection → gate fires.
    resetStores(makeHousehold());
    render(
      <MemoryRouter>
        <Roadmap />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /about the roadmap/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open roadmap/i })).toBeDisabled();
  });

  it('renders the page content when the gate is ready', () => {
    resetStores(makeHousehold(), ACCEPTED_VERSION);
    render(
      <MemoryRouter>
        <Roadmap />
      </MemoryRouter>,
    );
    // Persistent banner is always visible.
    expect(
      screen.getByText(/educational tool — not financial advice/i),
    ).toBeInTheDocument();
    // Section headers are rendered for all 7 sections.
    expect(screen.getByText('Section 0')).toBeInTheDocument();
    expect(screen.getByText('Section 6')).toBeInTheDocument();
    expect(screen.getByText('Budget and Essentials')).toBeInTheDocument();
    // Wave-4 a11y: the page has an h1 landmark heading.
    expect(screen.getByRole('heading', { level: 1, name: 'Roadmap' })).toBeInTheDocument();
  });

  it('renders the status legend above the section cards (W7-UX MF-2)', () => {
    resetStores(makeHousehold(), ACCEPTED_VERSION);
    render(
      <MemoryRouter>
        <Roadmap />
      </MemoryRouter>,
    );
    // The legend is a list labelled "Status legend" — both the
    // accessible name and the data-testid hook are stable contracts.
    const legend = screen.getByTestId('roadmap-status-legend');
    expect(legend).toBeInTheDocument();
    expect(legend).toHaveAttribute('aria-label', 'Status legend');
  });

  it('shows a setup prompt when the household has not loaded yet', () => {
    resetStores(null);
    render(
      <MemoryRouter>
        <Roadmap />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/set up your household to see your roadmap/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /set up household/i })).toHaveAttribute('href', '/inputs/household');
  });
});
