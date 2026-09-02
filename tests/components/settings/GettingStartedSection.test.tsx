import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { GettingStartedSection } from '@/components/settings/GettingStartedSection';
import { useTourStore } from '@/stores/tour-store';
import { EXPLORE_FLAG_KEY } from '@/lib/explore-mode';

/** Opaque to isExploreMode() — only presence matters (test-clock policy). */
const FLAG_SET_AT = '2026-07-08T12:00:00.000Z';

// Probe that reflects the current pathname so we can assert navigate('/').
function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="pathname">{pathname}</div>;
}

function renderSection() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route
          path="/settings"
          element={
            <>
              <GettingStartedSection />
              <LocationProbe />
            </>
          }
        />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('GettingStartedSection', () => {
  it('renders the standard section frame (title + helper line)', () => {
    renderSection();
    expect(
      screen.getByRole('heading', { name: /getting started/i }),
    ).toBeInTheDocument();
    // Helper copy in the muted-foreground line.
    expect(screen.getByText(/replay the guided tour/i)).toBeInTheDocument();
  });

  it('Replay tour calls useTourStore.start() and navigates to /', async () => {
    const start = vi.spyOn(useTourStore.getState(), 'start');
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: /replay tour/i }));

    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('pathname')).toHaveTextContent('/');
  });

  it('links to the Sidebar settings section via an in-page anchor', () => {
    renderSection();
    const link = screen.getByRole('link', { name: /sidebar settings/i });
    expect(link).toHaveAttribute('href', '#sidebar-settings');
  });

  it('links to the Calculators page so the user can manage card visibility', () => {
    renderSection();
    const link = screen.getByRole('link', { name: /calculators/i });
    // react-router renders Link `to` as the href.
    expect(link).toHaveAttribute('href', '/calculators');
  });

  it('Revisit setup links to /setup?origin=revisit with the CW-37 helper sentence', () => {
    renderSection();
    const link = screen.getByRole('link', { name: 'Revisit setup' });
    // Wave A item 3 (D-WA6): the revisit origin quiets the resume nudge.
    expect(link).toHaveAttribute('href', '/setup?origin=revisit');
    expect(
      screen.getByText('Reopens guided setup with your saved answers filled in.'),
    ).toBeInTheDocument();
  });

  // W4 (P-W4-7, D-S7): both launchers write REAL device-local keys, so they
  // are hidden — not merely disabled — while exploring.
  it('explore mode: hides both Replay tour and Revisit setup', () => {
    localStorage.setItem(EXPLORE_FLAG_KEY, FLAG_SET_AT);
    try {
      renderSection();
      expect(screen.queryByRole('button', { name: 'Replay tour' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Revisit setup' })).toBeNull();
      // The pointer links to the two visibility editors stay.
      expect(screen.getByRole('link', { name: 'Calculators' })).toBeInTheDocument();
    } finally {
      localStorage.removeItem(EXPLORE_FLAG_KEY);
    }
  });

  it('without the flag: both launchers render (production path untouched)', () => {
    renderSection();
    expect(screen.getByRole('button', { name: 'Replay tour' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Revisit setup' })).toBeInTheDocument();
  });
});
