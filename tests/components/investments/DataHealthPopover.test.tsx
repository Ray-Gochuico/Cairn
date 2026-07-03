import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFundHoldingsStore } from '@/stores/fund-holdings-store';
import { useFundSectorsStore } from '@/stores/fund-sectors-store';

// The popover's handlers hit Yahoo + the repos directly (1:1 move from the
// Investments page header). Mock the whole market/db seam; the tests assert
// call-through + rendered status, not sync internals (fund-holdings-sync has
// its own suite).
const syncStaleFunds = vi.fn();
vi.mock('@/market/fund-holdings-sync', () => ({
  syncStaleFunds: (...args: unknown[]) => syncStaleFunds(...args),
}));

const fundSectorWeightings = vi.fn();
vi.mock('@/market/yahoo-client', () => ({
  YahooClient: class {
    fundSectorWeightings(ticker: string) {
      return fundSectorWeightings(ticker);
    }
  },
}));

const dbExecute = vi.fn(async () => {});
vi.mock('@/db/db', () => ({
  getDatabase: () => ({
    execute: (...args: unknown[]) => dbExecute(...args),
    select: async () => [],
  }),
}));

const listAll = vi.fn(async (): Promise<Array<{ ticker: string }>> => []);
vi.mock('@/domain/holdings', () => ({
  HoldingsRepo: class {
    listAll() {
      return listAll();
    }
  },
}));

const lookup = vi.fn(async (_t: string): Promise<{ assetClass: string } | undefined> => undefined);
vi.mock('@/domain/tickers', () => ({
  TickersRepo: class {
    lookup(t: string) {
      return lookup(t);
    }
  },
}));

const upsertSectors = vi.fn(async () => {});
vi.mock('@/domain/fund-sectors', () => ({
  FundSectorsRepo: class {
    upsertSectors(...args: unknown[]) {
      return upsertSectors(...args);
    }
  },
}));

vi.mock('@/domain/fund-holdings', () => ({
  FundHoldingsRepo: class {},
}));

import { DataHealthPopover } from '@/components/investments/DataHealthPopover';

beforeEach(() => {
  vi.clearAllMocks();
  useFundHoldingsStore.setState({
    fundHoldings: [], isLoading: false, error: null, load: async () => {},
  } as never);
  useFundSectorsStore.setState({
    fundSectors: [], isLoading: false, error: null, load: async () => {},
  } as never);
});

describe('DataHealthPopover', () => {
  it('renders a Data health trigger; content is closed by default', () => {
    render(<DataHealthPopover />);
    expect(screen.getByRole('button', { name: /data health/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh fund data/i })).not.toBeInTheDocument();
  });

  it('opens to show both refresh actions and closes on Escape', async () => {
    render(<DataHealthPopover />);
    await userEvent.click(screen.getByRole('button', { name: /data health/i }));
    expect(screen.getByRole('button', { name: /refresh fund data/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /force refresh sectors/i })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /refresh fund data/i })).not.toBeInTheDocument();
  });

  it('runs the fund-data refresh and renders the summary counts', async () => {
    syncStaleFunds.mockResolvedValueOnce({ refreshed: ['VTI'], skipped: [], errors: [] });
    render(<DataHealthPopover />);
    await userEvent.click(screen.getByRole('button', { name: /data health/i }));
    await userEvent.click(screen.getByRole('button', { name: /refresh fund data/i }));
    expect(await screen.findByText(/Refreshed: VTI/)).toBeInTheDocument();
    expect(syncStaleFunds).toHaveBeenCalledTimes(1);
  });

  it('renders the per-ticker force-sectors status log (ok/empty/error rows)', async () => {
    listAll.mockResolvedValueOnce([{ ticker: 'VTI' }, { ticker: 'BND' }, { ticker: 'ERR' }]);
    lookup.mockImplementation(async () => ({ assetClass: 'US_TOTAL_MARKET' }));
    fundSectorWeightings.mockImplementation(async (ticker: string) => {
      if (ticker === 'VTI') return { sectors: [{ sector: 'Tech', weight: 1 }], asOf: '2026-07-01' };
      if (ticker === 'BND') return { sectors: [], asOf: '2026-07-01' };
      throw new Error('boom');
    });
    render(<DataHealthPopover />);
    await userEvent.click(screen.getByRole('button', { name: /data health/i }));
    await userEvent.click(screen.getByRole('button', { name: /force refresh sectors/i }));
    const log = await screen.findByTestId('force-sectors-status');
    expect(log).toHaveTextContent('VTI');
    expect(log).toHaveTextContent(/ok · 1 sectors loaded/);
    expect(log).toHaveTextContent(/empty · Yahoo returned no sectorWeightings/);
    expect(log).toHaveTextContent(/error · boom/);
    expect(upsertSectors).toHaveBeenCalledTimes(1); // only the non-empty fetch writes
  });
});
