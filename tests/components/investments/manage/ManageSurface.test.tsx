import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ManageSurface from '@/components/investments/manage/ManageSurface';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useTickersStore } from '@/stores/tickers-store';

describe('ManageSurface (W14)', () => {
  beforeEach(() => {
    // Resolved-empty store seeding (Wave-10 house pattern) — no DB needed.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} } as any);
    usePersonsStore.setState({ persons: [], isLoading: false, error: null, load: async () => {} } as any);
    useDependentsStore.setState({ dependents: [], isLoading: false, error: null, load: async () => {} } as any);
    useHoldingsStore.setState({ holdings: [], isLoading: false, error: null, load: async () => {} } as any);
    useContributionsStore.setState({ contributions: [], isLoading: false, error: null, load: async () => {} } as any);
    useTickersStore.setState({ tickers: [], isLoading: false, error: null, load: async () => {} } as any);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  it('renders the Manage region with four sub-tabs, defaulting to Accounts', async () => {
    render(
      <MemoryRouter initialEntries={['/investments']}>
        <ManageSurface />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /manage/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Accounts' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Holdings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Contributions' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tickers' })).toBeInTheDocument();
    // Accounts panel content is mounted.
    expect(await screen.findByText(/no accounts added yet/i)).toBeInTheDocument();
  });

  it('?manage=holdings preselects the Holdings sub-tab', async () => {
    render(
      <MemoryRouter initialEntries={['/investments?manage=holdings']}>
        <ManageSurface />
      </MemoryRouter>,
    );
    expect(screen.getByRole('tab', { name: 'Holdings' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(/add accounts first/i)).toBeInTheDocument();
  });

  it('an unknown ?manage value falls back to Accounts', () => {
    render(
      <MemoryRouter initialEntries={['/investments?manage=bogus']}>
        <ManageSurface />
      </MemoryRouter>,
    );
    expect(screen.getByRole('tab', { name: 'Accounts' })).toHaveAttribute('aria-selected', 'true');
  });

  it('clicking a sub-tab switches the panel', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/investments']}>
        <ManageSurface />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('tab', { name: 'Tickers' }));
    expect(screen.getByRole('tab', { name: 'Tickers' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(/no tickers yet/i)).toBeInTheDocument();
  });
});
