import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ExistingUserTourPrompt } from '@/pages/Dashboard';
import { useTourStore } from '@/stores/tour-store';
import { markSetupDismissed } from '@/lib/setup-dismissal';
import { isTourDone, markTourDone } from '@/lib/onboarding-state';

function renderPrompt() {
  return render(
    <MemoryRouter>
      <ExistingUserTourPrompt />
    </MemoryRouter>,
  );
}

describe('ExistingUserTourPrompt', () => {
  it('does not render for a brand-new user (setup not dismissed)', () => {
    // setup NOT dismissed, tour NOT done → no prompt.
    expect(isTourDone()).toBe(false);
    renderPrompt();
    expect(
      screen.queryByText(/take a quick tour/i),
    ).not.toBeInTheDocument();
  });

  it('does not render once the tour is done', () => {
    markSetupDismissed();
    markTourDone();
    renderPrompt();
    expect(
      screen.queryByText(/take a quick tour/i),
    ).not.toBeInTheDocument();
  });

  it('renders only when setup is dismissed AND the tour is not done', () => {
    markSetupDismissed();
    renderPrompt();
    expect(
      screen.getByRole('button', { name: /take a quick tour/i }),
    ).toBeInTheDocument();
  });

  it('"Take a quick tour" calls useTourStore.start()', async () => {
    markSetupDismissed();
    const start = vi.spyOn(useTourStore.getState(), 'start');
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole('button', { name: /take a quick tour/i }));

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('dismiss sets the tour-done marker and hides the prompt', async () => {
    markSetupDismissed();
    const user = userEvent.setup();
    renderPrompt();

    // Visible first.
    expect(
      screen.getByRole('button', { name: /take a quick tour/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /dismiss/i }));

    // Marker persisted...
    expect(isTourDone()).toBe(true);
    // ...and the prompt is gone (local hide, no remount needed).
    expect(
      screen.queryByText(/take a quick tour/i),
    ).not.toBeInTheDocument();
  });
});
