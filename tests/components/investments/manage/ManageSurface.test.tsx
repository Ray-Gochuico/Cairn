import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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

// C1 (smoke M3, 2026-09-02): `?manage=contributions` selected the tab but the
// region stayed below the fold — the mount-time scroll landed, then the
// analysis cards above finished measuring and pushed it back down. The
// region now scrolls once its position has been stable for two 50ms ticks.
describe('ManageSurface — ?manage deep link scrolls once the layout settles (C1)', () => {
  let targets: Element[];
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} } as any);
    usePersonsStore.setState({ persons: [], isLoading: false, error: null, load: async () => {} } as any);
    useDependentsStore.setState({ dependents: [], isLoading: false, error: null, load: async () => {} } as any);
    useHoldingsStore.setState({ holdings: [], isLoading: false, error: null, load: async () => {} } as any);
    useContributionsStore.setState({ contributions: [], isLoading: false, error: null, load: async () => {} } as any);
    useTickersStore.setState({ tickers: [], isLoading: false, error: null, load: async () => {} } as any);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    vi.useFakeTimers();
    targets = [];
    spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) { targets.push(this); });
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { spy.mockRestore(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('?manage=contributions selects the tab AND scrolls the region to its start after two stable ticks', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/investments?manage=contributions']}>
        <ManageSurface />
      </MemoryRouter>,
    );
    expect(screen.getByRole('tab', { name: 'Contributions' })).toHaveAttribute('aria-selected', 'true');
    expect(spy).not.toHaveBeenCalled();                      // never on the mount commit (the M3 bug)
    act(() => { vi.advanceTimersByTime(100); });
    expect(spy).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(50); });
    expect(targets).toEqual([container.querySelector('section')]);
    expect(spy).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a region still being pushed down by the cards above waits until it holds still', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/investments?manage=contributions']}>
        <ManageSurface />
      </MemoryRouter>,
    );
    const region = container.querySelector('section') as HTMLElement;
    const tops = [400, 700, 900, 900, 900];
    let i = 0;
    region.getBoundingClientRect = () => ({ top: tops[Math.min(i++, tops.length - 1)] } as DOMRect);
    act(() => { vi.advanceTimersByTime(150); });             // 400 → 700 → 900
    expect(spy).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(100); });             // 900, 900
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('no ?manage param → no scroll', () => {
    render(
      <MemoryRouter initialEntries={['/investments']}>
        <ManageSurface />
      </MemoryRouter>,
    );
    act(() => { vi.advanceTimersByTime(2000); });
    expect(spy).not.toHaveBeenCalled();
  });
});
