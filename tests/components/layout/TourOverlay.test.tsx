import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppSettingsSchema, type AppSettings } from '@/types/schema';
import { RefreshCadence } from '@/types/enums';
import { useSettingsStore } from '@/stores/settings-store';
import { useTourStore } from '@/stores/tour-store';
import TourOverlay from '@/components/layout/TourOverlay';

// Spy on the marker without losing the other onboarding-state helpers.
const markTourDone = vi.fn();
vi.mock('@/lib/onboarding-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/onboarding-state')>();
  return { ...actual, markTourDone: () => markTourDone() };
});

/** Minimal valid AppSettings via schema defaults; override sidebarLayout per test. */
function makeSettings(over: Partial<AppSettings> = {}): AppSettings {
  return AppSettingsSchema.parse({
    id: 1,
    sidebarLayout: null,
    notificationsEnabled: false,
    notificationDay: 1,
    refreshCadence: RefreshCadence.MANUAL,
    lastRefreshAt: null,
    statementsFolderPath: null,
    lastSeenMonth: null,
    ...over,
  });
}

/**
 * Plant fake sidebar anchors so the overlay can "find" a target by
 * data-tour-id (geometry is irrelevant — getBoundingClientRect is zeros in
 * jsdom; we only assert the overlay doesn't crash and renders the popover).
 */
function plantAnchors(tos: string[]) {
  const aside = document.createElement('aside');
  for (const to of tos) {
    const a = document.createElement('a');
    a.setAttribute('data-tour-id', to);
    aside.appendChild(a);
  }
  document.body.appendChild(aside);
  return aside;
}

/** A sidebarLayout overlay hiding all non-core tabs → core ∩ visible = the 6 core. */
const HIDE_NONCORE = [
  { to: '/loans', hidden: true },
  { to: '/property', hidden: true },
  { to: '/vehicles', hidden: true },
  { to: '/equity-grants', hidden: true },
  { to: '/spending', hidden: true },
  { to: '/goals', hidden: true },
  { to: '/roadmap', hidden: true },
  { to: '/learn', hidden: true },
  { to: '/what-if', hidden: true },
  { to: '/calculators/backtest', hidden: true },
  { to: '/inputs', hidden: true },
];

describe('TourOverlay', () => {
  beforeEach(() => {
    markTourDone.mockClear();
    document.body.innerHTML = '';
    useTourStore.setState({ active: false, stepIndex: 0, mode: 'core' });
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
  });

  const renderOverlay = () =>
    render(<MemoryRouter><TourOverlay /></MemoryRouter>);

  it('renders nothing when the tour is inactive', () => {
    useSettingsStore.setState({ settings: makeSettings() });
    const { container } = renderOverlay();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while settings is still null (settings !== null gate)', () => {
    useTourStore.setState({ active: true });
    const { container } = renderOverlay();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the first core step heading, live region, and "1 of 6"', () => {
    plantAnchors(['/', '/net-worth', '/budget', '/investments', '/calculators', '/settings']);
    useSettingsStore.setState({ settings: makeSettings({ sidebarLayout: HIDE_NONCORE }) });
    useTourStore.setState({ active: true, stepIndex: 0, mode: 'core' });
    renderOverlay();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /your dashboard/i })).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-live', 'polite');
    expect(within(dialog).getByText(/1 of 6/i)).toBeInTheDocument();
  });

  it('focuses the step heading on render', () => {
    plantAnchors(['/', '/net-worth', '/budget', '/investments', '/calculators', '/settings']);
    useSettingsStore.setState({ settings: makeSettings({ sidebarLayout: HIDE_NONCORE }) });
    useTourStore.setState({ active: true });
    renderOverlay();
    const heading = screen.getByRole('heading', { name: /your dashboard/i });
    expect(heading).toHaveFocus();
  });

  it('renders the scrim with bg-black/40 and the popover AFTER it in DOM order', () => {
    plantAnchors(['/', '/net-worth', '/budget', '/investments', '/calculators', '/settings']);
    useSettingsStore.setState({ settings: makeSettings({ sidebarLayout: HIDE_NONCORE }) });
    useTourStore.setState({ active: true });
    const { container } = renderOverlay();
    const scrim = container.querySelector('[data-tour-scrim]');
    const popover = container.querySelector('[role="dialog"]');
    expect(scrim).not.toBeNull();
    expect(scrim?.className).toContain('bg-black/40');
    // Popover must come after the scrim so single-z-50-container stacking holds.
    expect(scrim!.compareDocumentPosition(popover!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Next advances to "2 of 6" and Back returns', async () => {
    const user = userEvent.setup();
    plantAnchors(['/', '/net-worth', '/budget', '/investments', '/calculators', '/settings']);
    useSettingsStore.setState({ settings: makeSettings({ sidebarLayout: HIDE_NONCORE }) });
    useTourStore.setState({ active: true });
    renderOverlay();
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(/2 of 6/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /net worth/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText(/1 of 6/i)).toBeInTheDocument();
  });

  it('last core step shows See the rest (secondary) + Done (primary); Done ends + marks', async () => {
    const user = userEvent.setup();
    // Keep ONE non-core tab visible so "See the rest" is offered.
    const hideAllButLoans = HIDE_NONCORE.filter((e) => e.to !== '/loans');
    plantAnchors(['/', '/net-worth', '/budget', '/investments', '/calculators', '/settings', '/loans']);
    useSettingsStore.setState({ settings: makeSettings({ sidebarLayout: hideAllButLoans }) });
    useTourStore.setState({ active: true, stepIndex: 5, mode: 'core' }); // last core step (/settings)
    renderOverlay();
    expect(screen.getByText(/6 of 6/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /see the rest/i })).toBeInTheDocument();
    const done = screen.getByRole('button', { name: /^done$/i });
    await user.click(done);
    expect(markTourDone).toHaveBeenCalledTimes(1);
    expect(useTourStore.getState().active).toBe(false);
  });

  it('See the rest enters mode:all and re-expands the denominator (6 of 7, never 7 of 6)', async () => {
    const user = userEvent.setup();
    const hideAllButLoans = HIDE_NONCORE.filter((e) => e.to !== '/loans');
    plantAnchors(['/', '/net-worth', '/budget', '/investments', '/calculators', '/settings', '/loans']);
    useSettingsStore.setState({ settings: makeSettings({ sidebarLayout: hideAllButLoans }) });
    useTourStore.setState({ active: true, stepIndex: 5, mode: 'core' });
    renderOverlay();
    await user.click(screen.getByRole('button', { name: /see the rest/i }));
    expect(useTourStore.getState().mode).toBe('all');
    // 7 visible tabs total (6 core + Loans); advanced to index 6 → "7 of 7"
    // OR stays at 5 → "6 of 7". Either way the denominator is the full 7.
    expect(screen.getByText(/ of 7/i)).toBeInTheDocument();
    expect(screen.queryByText(/of 6/i)).toBeNull();
  });

  it('omits See the rest on the last core step when no non-core tabs are visible', () => {
    plantAnchors(['/', '/net-worth', '/budget', '/investments', '/calculators', '/settings']);
    useSettingsStore.setState({ settings: makeSettings({ sidebarLayout: HIDE_NONCORE }) });
    useTourStore.setState({ active: true, stepIndex: 5, mode: 'core' });
    renderOverlay();
    expect(screen.getByRole('button', { name: /^done$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /see the rest/i })).toBeNull();
  });

  it('Skip tour ends the tour and marks it done', async () => {
    const user = userEvent.setup();
    plantAnchors(['/', '/net-worth', '/budget', '/investments', '/calculators', '/settings']);
    useSettingsStore.setState({ settings: makeSettings({ sidebarLayout: HIDE_NONCORE }) });
    useTourStore.setState({ active: true });
    renderOverlay();
    await user.click(screen.getByRole('button', { name: /skip tour/i }));
    expect(markTourDone).toHaveBeenCalledTimes(1);
    expect(useTourStore.getState().active).toBe(false);
  });

  it('Escape ends the tour', async () => {
    const user = userEvent.setup();
    plantAnchors(['/', '/net-worth', '/budget', '/investments', '/calculators', '/settings']);
    useSettingsStore.setState({ settings: makeSettings({ sidebarLayout: HIDE_NONCORE }) });
    useTourStore.setState({ active: true });
    renderOverlay();
    await user.keyboard('{Escape}');
    expect(useTourStore.getState().active).toBe(false);
    expect(markTourDone).toHaveBeenCalledTimes(1);
  });

  it('renders a centered fallback popover when the target anchor is missing', () => {
    // No anchors planted → getBoundingClientRect path never finds an element.
    useSettingsStore.setState({ settings: makeSettings({ sidebarLayout: HIDE_NONCORE }) });
    useTourStore.setState({ active: true });
    expect(() => renderOverlay()).not.toThrow();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
