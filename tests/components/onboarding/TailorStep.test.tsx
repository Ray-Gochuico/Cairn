import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TailorStep } from '@/components/onboarding/TailorStep';
import { useSettingsStore } from '@/stores/settings-store';
import { applySidebarLayout } from '@/lib/sidebar-layout';
import { DEFAULT_SECTIONS } from '@/components/layout/Sidebar';
import type { TailoringResult } from '@/lib/onboarding-tailoring';
import type { SidebarLayoutEntry, CardLayoutEntry } from '@/types/schema';

// The full set of tab routes the complete overlay must always carry,
// in DEFAULT_SECTIONS order. Derived from the real constant so this test
// tracks any future tab without edits.
const ALL_TOS = DEFAULT_SECTIONS.flatMap((s) => s.items.map((i) => i.to));
// Core tabs = every tab NOT named by a hide rule in the result fixture.
// We assert these come back hidden:false regardless of how rows toggle.

// A result with one tab hide-rec (/property) and one calc hide-rec (bonus-tax).
function makeResult(): TailoringResult {
  return {
    tabs: [
      { to: '/property', label: 'Property', visible: false, reason: 'no property entered' },
    ],
    calculators: [
      { id: 'bonus-tax', label: 'Bonus tax', visible: false, reason: 'no bonus entered' },
      { id: 'overtime', label: 'Overtime', visible: true, reason: 'hourly employment' },
    ],
  };
}

// Install a mock settings store whose update() is a controllable spy.
function installStore(
  update: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
) {
  useSettingsStore.setState({
    settings: null,
    isLoading: false,
    error: null,
    load: async () => {},
    update,
  } as never);
  return update;
}

// Pull the single update() payload, asserting exactly one call.
function soleUpdatePayload(update: ReturnType<typeof vi.fn>): {
  sidebarLayout: SidebarLayoutEntry[];
  calculatorCardLayout: CardLayoutEntry[];
} {
  expect(update).toHaveBeenCalledTimes(1);
  return update.mock.calls[0][0];
}

describe('TailorStep', () => {
  beforeEach(() => {
    installStore();
  });

  it('renders both groups, the standing caption, and the step indicator', () => {
    render(
      <TailorStep result={makeResult()} totalSteps={3} onDone={vi.fn()} onSkip={vi.fn()} />,
    );
    expect(screen.getByText('Tabs · from your data')).toBeInTheDocument();
    expect(screen.getByText('Calculators')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Hidden tabs/tools aren't deleted — flip any row on, or restore later in Settings.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
  });

  it('seeds each row Switch from the recommendation (on = visible)', () => {
    render(
      <TailorStep result={makeResult()} totalSteps={3} onDone={vi.fn()} onSkip={vi.fn()} />,
    );
    // /property recommended hidden → off; overtime recommended visible → on.
    expect(screen.getByRole('switch', { name: /Property/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: /Overtime/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: /Bonus tax/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('on Done writes a COMPLETE sidebarLayout: core tabs hidden:false, DEFAULT_SECTIONS order, never /settings hidden', async () => {
    const update = installStore();
    const user = userEvent.setup();
    render(
      <TailorStep result={makeResult()} totalSteps={3} onDone={vi.fn()} onSkip={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));

    const { sidebarLayout } = soleUpdatePayload(update);
    // Every tab present, in order.
    expect(sidebarLayout.map((e) => e.to)).toEqual(ALL_TOS);
    // /settings never hidden.
    expect(sidebarLayout.find((e) => e.to === '/settings')!.hidden).toBe(false);
    // Every core (non-listed) tab is hidden:false.
    const listed = new Set(['/property']);
    for (const e of sidebarLayout) {
      if (!listed.has(e.to)) expect(e.hidden).toBe(false);
    }
    // The one listed-and-off tab is hidden:true.
    expect(sidebarLayout.find((e) => e.to === '/property')!.hidden).toBe(true);
  });

  it('the built sidebarLayout round-trips through applySidebarLayout to the intended visible set', async () => {
    const update = installStore();
    const user = userEvent.setup();
    render(
      <TailorStep result={makeResult()} totalSteps={3} onDone={vi.fn()} onSkip={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));

    const { sidebarLayout } = soleUpdatePayload(update);
    const applied = applySidebarLayout(DEFAULT_SECTIONS, sidebarLayout)
      .flatMap((s) => s.items.map((i) => i.to));
    // /property dropped; everything else (incl. /settings) survives, in order.
    expect(applied).toEqual(ALL_TOS.filter((to) => to !== '/property'));
  });

  it('on Done writes a COMPLETE calculatorCardLayout for the 12 ids with the right hidden flags', async () => {
    const update = installStore();
    const user = userEvent.setup();
    render(
      <TailorStep result={makeResult()} totalSteps={3} onDone={vi.fn()} onSkip={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));

    const { calculatorCardLayout } = soleUpdatePayload(update);
    const TWELVE = [
      'paycheck', 'bonus-tax', 'commission-tax', 'overtime',
      'financial-independence', 'coast-fi', 'compound-interest', 'debt-payoff',
      'equity', 'retirement-401k-withdrawal', 'backtest', 'contribution-allocator',
    ];
    expect(calculatorCardLayout.map((e) => e.id).sort()).toEqual([...TWELVE].sort());
    // bonus-tax recommended off → hidden:true; overtime on → hidden:false.
    expect(calculatorCardLayout.find((e) => e.id === 'bonus-tax')!.hidden).toBe(true);
    expect(calculatorCardLayout.find((e) => e.id === 'overtime')!.hidden).toBe(false);
    // A calc with no row (not in result) defaults visible → hidden:false.
    expect(calculatorCardLayout.find((e) => e.id === 'paycheck')!.hidden).toBe(false);
  });

  it('issues exactly ONE update() call carrying BOTH keys, then calls onDone', async () => {
    const update = installStore();
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(
      <TailorStep result={makeResult()} totalSteps={3} onDone={onDone} onSkip={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(['calculatorCardLayout', 'sidebarLayout']);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('toggling a row Switch flips the persisted hidden value', async () => {
    const update = installStore();
    const user = userEvent.setup();
    render(
      <TailorStep result={makeResult()} totalSteps={3} onDone={vi.fn()} onSkip={vi.fn()} />,
    );
    // /property starts off (hidden). Flip it ON → should persist hidden:false.
    await user.click(screen.getByRole('switch', { name: /Property/i }));
    await user.click(screen.getByRole('button', { name: 'Done' }));

    const { sidebarLayout } = soleUpdatePayload(update);
    expect(sidebarLayout.find((e) => e.to === '/property')!.hidden).toBe(false);
  });

  it('on update() rejection shows inline retry and does NOT call onDone', async () => {
    const update = installStore(vi.fn().mockRejectedValue(new Error('db locked')));
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(
      <TailorStep result={makeResult()} totalSteps={3} onDone={onDone} onSkip={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));

    await screen.findByText(/couldn't save/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('Skip persists nothing and calls onSkip', async () => {
    const update = installStore();
    const onSkip = vi.fn();
    const user = userEvent.setup();
    render(
      <TailorStep result={makeResult()} totalSteps={3} onDone={vi.fn()} onSkip={onSkip} />,
    );
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(update).not.toHaveBeenCalled();
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
