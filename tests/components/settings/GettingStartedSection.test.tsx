import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { GettingStartedSection } from '@/components/settings/GettingStartedSection';
import { useTourStore } from '@/stores/tour-store';

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
});
