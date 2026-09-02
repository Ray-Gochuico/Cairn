import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SetupWizard from '@/pages/setup/SetupWizard';
import OnboardingController from '@/pages/setup/OnboardingController';
import { EXPLORE_FLAG_KEY } from '@/lib/explore-mode';

/**
 * W4 (D-S5/D-S7): /setup and /welcome are the ONLY routes outside PageShell,
 * and both are writers of real device-local state (setupWizard.dismissed.v1,
 * setupWizard.progress.v2, onboarding.tailor.done.v1, onboarding.tour.done.v1).
 * While exploring they must mount-guard to '/', so every reachable surface
 * sits under the sample banner and no real key can be written from the
 * throwaway session.
 */

/** Opaque to isExploreMode() — only presence matters (test-clock policy). */
const FLAG_SET_AT = '2026-07-08T12:00:00.000Z';

function renderAt(path: string, element: React.ReactNode) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>dashboard stub</div>} />
        <Route path={path} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('explore mount-guards on the non-shell routes', () => {
  afterEach(() => {
    localStorage.removeItem(EXPLORE_FLAG_KEY);
  });

  it('/setup redirects to "/" while exploring (the wizard never mounts)', () => {
    localStorage.setItem(EXPLORE_FLAG_KEY, FLAG_SET_AT);
    renderAt('/setup', <SetupWizard />);
    expect(screen.getByText('dashboard stub')).toBeInTheDocument();
  });

  it('/welcome redirects to "/" while exploring (the tour/tailor flow never mounts)', () => {
    localStorage.setItem(EXPLORE_FLAG_KEY, FLAG_SET_AT);
    renderAt('/welcome', <OnboardingController />);
    expect(screen.getByText('dashboard stub')).toBeInTheDocument();
  });

  it('without the flag: /welcome mounts its own screen (production path untouched)', () => {
    renderAt('/welcome', <OnboardingController />);
    expect(screen.queryByText('dashboard stub')).toBeNull();
  });
});
