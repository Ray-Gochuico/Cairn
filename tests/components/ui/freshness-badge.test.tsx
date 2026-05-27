import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FreshnessBadge } from '@/components/ui/freshness-badge';
import { useSettingsStore } from '@/stores/settings-store';
import { RefreshCadence } from '@/types/enums';
import type { AppSettings } from '@/types/schema';

/**
 * Build a minimal AppSettings stub for tests. Only fields the badge reads
 * are exercised — refreshCadence + lastRefreshAt. The rest get reasonable
 * defaults so consumers of the store don't crash.
 */
function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    id: 1,
    sidebarLayout: null,
    notificationsEnabled: false,
    notificationDay: 1,
    refreshCadence: RefreshCadence.DAILY,
    lastRefreshAt: null,
    statementsFolderPath: null,
    defaultInflation: null,
    defaultReturnRate: null,
    defaultFiPillsPosition: 'above',
    defaultProjectionDetailLevel: 'tax_bucket',
    defaultCashApy: null,
    defaultCompoundingFrequency: 'MONTHLY',
    propertyUtilitiesCategoryIds: null,
    vehicleGasCategoryIds: null,
    ...overrides,
  } as AppSettings;
}

/**
 * Fixed "now" for deterministic distance copy. Picked a midday timestamp
 * so DST and timezone math don't flip the rounded text.
 */
const NOW = new Date('2026-05-27T12:00:00.000Z');

beforeEach(() => {
  // Pin Date.now() so date-fns produces stable "X ago" copy. Returning a
  // fresh Date instance from each constructor call mirrors how the
  // component reads `new Date()`.
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  useSettingsStore.setState({ settings: null, isLoading: false, error: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('FreshnessBadge', () => {
  it('renders nothing if lastRefreshAt is null (first-launch user)', () => {
    useSettingsStore.setState({
      settings: makeSettings({ lastRefreshAt: null }),
      isLoading: false,
      error: null,
    });
    const { container } = render(<FreshnessBadge />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('freshness-badge')).not.toBeInTheDocument();
  });

  it('renders nothing if the explicit prop is null even when the store has a value', () => {
    useSettingsStore.setState({
      settings: makeSettings({ lastRefreshAt: '2026-05-26T10:00:00.000Z' }),
      isLoading: false,
      error: null,
    });
    const { container } = render(<FreshnessBadge lastRefreshAt={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing if lastRefreshAt is a garbage string (defensive)', () => {
    useSettingsStore.setState({
      settings: makeSettings({ lastRefreshAt: 'not a date' }),
      isLoading: false,
      error: null,
    });
    const { container } = render(<FreshnessBadge />);
    expect(container.firstChild).toBeNull();
  });

  it('shows "Updated X ago" for a recent timestamp', () => {
    // 3 hours ago at fixed NOW
    const threeHoursAgo = new Date(NOW.getTime() - 3 * 60 * 60 * 1000);
    render(
      <FreshnessBadge
        lastRefreshAt={threeHoursAgo.toISOString()}
        cadence={RefreshCadence.DAILY}
      />,
    );
    const badge = screen.getByTestId('freshness-badge');
    expect(badge).toHaveTextContent(/updated about 3 hours ago/i);
    // Recent — no warning state attribute.
    expect(badge).not.toHaveAttribute('data-stale');
  });

  it('formats "X minutes ago" for very recent refreshes', () => {
    const fiveMinAgo = new Date(NOW.getTime() - 5 * 60 * 1000);
    render(
      <FreshnessBadge
        lastRefreshAt={fiveMinAgo.toISOString()}
        cadence={RefreshCadence.DAILY}
      />,
    );
    expect(screen.getByTestId('freshness-badge')).toHaveTextContent(
      /updated 5 minutes ago/i,
    );
  });

  it('flips to warning state when older than DAILY × 1.5 (36+ hours)', () => {
    // 40 hours ago — past the 36-hour threshold for daily cadence.
    const fortyHoursAgo = new Date(NOW.getTime() - 40 * 60 * 60 * 1000);
    render(
      <FreshnessBadge
        lastRefreshAt={fortyHoursAgo.toISOString()}
        cadence={RefreshCadence.DAILY}
      />,
    );
    const badge = screen.getByTestId('freshness-badge');
    expect(badge).toHaveAttribute('data-stale', 'true');
    // Warning styling — verify the warning-soft background class lands.
    expect(badge.className).toMatch(/bg-warning-soft/);
  });

  it('stays in non-warning state when within the cadence threshold', () => {
    // 25 hours ago — past daily threshold (24h) but inside the 1.5x grace.
    const twentyFiveHoursAgo = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
    render(
      <FreshnessBadge
        lastRefreshAt={twentyFiveHoursAgo.toISOString()}
        cadence={RefreshCadence.DAILY}
      />,
    );
    const badge = screen.getByTestId('freshness-badge');
    expect(badge).not.toHaveAttribute('data-stale');
  });

  it('flips to warning at WEEKLY × 1.5 (10.5+ days)', () => {
    const elevenDaysAgo = new Date(NOW.getTime() - 11 * 24 * 60 * 60 * 1000);
    render(
      <FreshnessBadge
        lastRefreshAt={elevenDaysAgo.toISOString()}
        cadence={RefreshCadence.WEEKLY}
      />,
    );
    expect(screen.getByTestId('freshness-badge')).toHaveAttribute(
      'data-stale',
      'true',
    );
  });

  it('does NOT warn when cadence is MANUAL even if the data is ancient', () => {
    // 90 days old, but the user explicitly opted out of automatic refreshes
    // — no nag.
    const ninetyDaysAgo = new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000);
    render(
      <FreshnessBadge
        lastRefreshAt={ninetyDaysAgo.toISOString()}
        cadence={RefreshCadence.MANUAL}
      />,
    );
    const badge = screen.getByTestId('freshness-badge');
    expect(badge).not.toHaveAttribute('data-stale');
    // Still surfaces the distance — silence is consent for the warning,
    // not for hiding the truth.
    expect(badge).toHaveTextContent(/updated 3 months ago/i);
  });

  it('includes the exact local timestamp in the aria-label', () => {
    const t = new Date(NOW.getTime() - 60 * 60 * 1000);
    render(
      <FreshnessBadge
        lastRefreshAt={t.toISOString()}
        cadence={RefreshCadence.DAILY}
      />,
    );
    const badge = screen.getByTestId('freshness-badge');
    // toLocaleString() varies by environment; assert the prefix + that the
    // local representation appears.
    expect(badge).toHaveAttribute(
      'aria-label',
      `Market prices last updated ${t.toLocaleString()}`,
    );
  });

  it('reads from useSettingsStore when no override prop is provided', () => {
    const t = new Date(NOW.getTime() - 60 * 60 * 1000);
    useSettingsStore.setState({
      settings: makeSettings({
        lastRefreshAt: t.toISOString(),
        refreshCadence: RefreshCadence.DAILY,
      }),
      isLoading: false,
      error: null,
    });
    render(<FreshnessBadge />);
    expect(screen.getByTestId('freshness-badge')).toHaveTextContent(
      /updated about 1 hour ago/i,
    );
  });

  it('shows cadence label in the popover on hover', async () => {
    vi.useRealTimers(); // user-event hovers need real timers
    const t = new Date(NOW.getTime() - 60 * 60 * 1000);
    render(
      <FreshnessBadge
        lastRefreshAt={t.toISOString()}
        cadence={RefreshCadence.WEEKLY}
      />,
    );
    const user = userEvent.setup();
    const badge = screen.getByTestId('freshness-badge');
    await user.hover(badge);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(/refresh cadence/i);
    expect(tooltip).toHaveTextContent(/weekly/i);
  });

  it('renders a "Refresh now" action inside the popover', async () => {
    vi.useRealTimers();
    const t = new Date(NOW.getTime() - 60 * 60 * 1000);
    render(
      <FreshnessBadge
        lastRefreshAt={t.toISOString()}
        cadence={RefreshCadence.DAILY}
      />,
    );
    const user = userEvent.setup();
    await user.hover(screen.getByTestId('freshness-badge'));
    await waitFor(() => {
      expect(screen.getByTestId('freshness-refresh-now')).toBeInTheDocument();
    });
  });

  it('supports the "md" size variant with larger text', () => {
    const t = new Date(NOW.getTime() - 60 * 60 * 1000);
    render(
      <FreshnessBadge
        lastRefreshAt={t.toISOString()}
        cadence={RefreshCadence.DAILY}
        size="md"
      />,
    );
    const badge = screen.getByTestId('freshness-badge');
    expect(badge.className).toMatch(/text-sm/);
  });

  it('applies a passed-in className to the badge for layout', () => {
    const t = new Date(NOW.getTime() - 60 * 60 * 1000);
    render(
      <FreshnessBadge
        lastRefreshAt={t.toISOString()}
        cadence={RefreshCadence.DAILY}
        className="ml-2"
      />,
    );
    expect(screen.getByTestId('freshness-badge').className).toMatch(/ml-2/);
  });
});
