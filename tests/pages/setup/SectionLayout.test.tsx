import { describe, it, expect, beforeEach, vi } from 'vitest';

// Section 4 mounts TransactionsSectionImporter, which pulls in the PDF
// extract + parse pipeline. Mock both so SectionLayout can render without
// booting pdfjs in jsdom.
vi.mock('@/pdf/extract', () => ({
  extractTextItems: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/pdf/parse-statement', () => ({
  parseStatement: vi.fn().mockReturnValue({
    issuer: 'GENERIC',
    transactions: [],
  }),
}));
vi.mock('@/lib/statements-archive', () => ({
  archiveStatementPdf: vi.fn().mockResolvedValue(null),
  resolveArchivePath: vi.fn(),
}));

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import SectionLayout from '@/pages/setup/SectionLayout';
import {
  isSetupDismissed,
  shouldRedirectToSetup,
} from '@/lib/setup-dismissal';
import { markTailorDone } from '@/lib/onboarding-state';
import { useAccountsStore } from '@/stores/accounts-store';

describe('SectionLayout', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset the data stores SectionLayout reads to derive the done-vs-visited
    // badge (H3) so seeded entities don't leak across tests.
    useAccountsStore.setState({ accounts: [] } as never);
  });

  it('renders a top progress bar with all 4 sections', () => {
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    const progressNav = screen.getByRole('navigation', {
      name: /setup progress/i,
    });
    expect(progressNav).toBeInTheDocument();
    expect(progressNav.textContent).toMatch(/Who you are/i);
    expect(progressNav.textContent).toMatch(/What you own/i);
    expect(progressNav.textContent).toMatch(/What you owe/i);
    expect(progressNav.textContent).toMatch(/History & goals/i);
  });

  it('starts at Section 1 when localStorage is empty', () => {
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /Section 1 of 4/i }),
    ).toBeInTheDocument();
  });

  it('corrupt persisted progress falls back to defaults instead of crashing (W10 T5)', () => {
    localStorage.setItem('setupWizard.progress.v1', JSON.stringify({ currentSection: 2, sectionStatus: 'garbage' }));
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    // defaultProgress() → Section 1, not a crash from the unchecked cast.
    expect(screen.getByRole('heading', { name: /Section 1 of 4/i })).toBeInTheDocument();
  });

  it('persists currentSection to localStorage on advance', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /next section/i }));
    const stored = JSON.parse(
      localStorage.getItem('setupWizard.progress.v1') ?? '{}',
    );
    expect(stored.currentSection).toBe(2);
  });

  it('restores currentSection from localStorage on remount', () => {
    localStorage.setItem(
      'setupWizard.progress.v1',
      JSON.stringify({
        currentSection: 3,
        sectionStatus: {
          1: 'completed',
          2: 'completed',
          3: 'pending',
          4: 'pending',
        },
        startedAt: '2026-05-26T12:00:00Z',
      }),
    );
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /Section 3 of 4/i }),
    ).toBeInTheDocument();
  });

  it('clears localStorage on Finish setup (in Section 4)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'setupWizard.progress.v1',
      JSON.stringify({
        currentSection: 4,
        sectionStatus: {
          1: 'completed',
          2: 'completed',
          3: 'completed',
          4: 'in_progress',
        },
        startedAt: '2026-05-26T12:00:00Z',
      }),
    );
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /finish setup/i }));
    expect(localStorage.getItem('setupWizard.progress.v1')).toBeNull();
  });

  it('sets the setup-dismissed marker on Finish so a zero-persons boot does NOT re-redirect (H1)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'setupWizard.progress.v1',
      JSON.stringify({
        currentSection: 4,
        sectionStatus: {
          1: 'skipped',
          2: 'completed',
          3: 'skipped',
          4: 'in_progress',
        },
        startedAt: '2026-05-26T12:00:00Z',
      }),
    );
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    expect(isSetupDismissed()).toBe(false);
    await user.click(screen.getByRole('button', { name: /finish setup/i }));
    // Marker persisted…
    expect(isSetupDismissed()).toBe(true);
    // …so the first-launch predicate no longer redirects despite zero persons.
    expect(
      shouldRedirectToSetup({ personCount: 0, dismissed: isSetupDismissed(), path: '/' }),
    ).toBe(false);
  });

  it('falls back to fresh state when localStorage JSON is malformed', () => {
    localStorage.setItem('setupWizard.progress.v1', '{not json}');
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /Section 1 of 4/i }),
    ).toBeInTheDocument();
  });

  it('shows Previous section disabled on Section 1', () => {
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    const prev = screen.getByRole('button', { name: /previous section/i });
    expect(prev).toBeDisabled();
  });

  it('auto-advances when the user clicks Skip on the entry gate', async () => {
    // Smoke-test 2026-05-27 finding: clicking "Skip — none of this applies"
    // marked the section as skipped but stayed on the same entry-gate
    // card; users had to also click "Next section" at the bottom of the
    // wizard chrome, which read as the skip not working. Treat skip on
    // the CURRENT section as a one-click mark-and-advance.
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    // Section 1 starts at the entry gate ("Start" / "Skip" buttons).
    await user.click(
      screen.getByRole('button', { name: /skip — none of this applies/i }),
    );
    // Should land on Section 2's heading.
    expect(
      screen.getByRole('heading', { name: /Section 2 of 4/i }),
    ).toBeInTheDocument();
    // localStorage should reflect both: section 1 marked skipped + cursor
    // on section 2.
    const stored = JSON.parse(
      localStorage.getItem('setupWizard.progress.v1') ?? '{}',
    );
    expect(stored.currentSection).toBe(2);
    expect(stored.sectionStatus[1]).toBe('skipped');
  });

  it('shows "visited" (not "✓ done") for a completed section that wrote no entities (H3)', () => {
    // Section 2 (What you own) completed but empty: no accounts/holdings/etc.
    useAccountsStore.setState({ accounts: [] } as never);
    localStorage.setItem(
      'setupWizard.progress.v1',
      JSON.stringify({
        currentSection: 3,
        sectionStatus: {
          1: 'completed',
          2: 'completed',
          3: 'in_progress',
          4: 'pending',
        },
        startedAt: '2026-05-26T12:00:00Z',
      }),
    );
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    const section2Chip = screen.getByRole('button', { name: /What you own/i });
    expect(within(section2Chip).queryByText(/✓ done/i)).toBeNull();
    expect(within(section2Chip).getByText(/visited/i)).toBeInTheDocument();
  });

  it('shows "✓ done" for a completed section that wrote at least one entity (H3)', () => {
    // Section 2 completed WITH an account → green "✓ done" implies data exists.
    useAccountsStore.setState({
      accounts: [{ id: 1, name: 'Checking' }],
    } as never);
    localStorage.setItem(
      'setupWizard.progress.v1',
      JSON.stringify({
        currentSection: 3,
        sectionStatus: {
          1: 'completed',
          2: 'completed',
          3: 'in_progress',
          4: 'pending',
        },
        startedAt: '2026-05-26T12:00:00Z',
      }),
    );
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    const section2Chip = screen.getByRole('button', { name: /What you own/i });
    expect(within(section2Chip).getByText(/✓ done/i)).toBeInTheDocument();
    expect(within(section2Chip).queryByText(/visited/i)).toBeNull();
  });

  it('moves focus to the section heading when the section changes (M2 a11y)', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /next section/i }));
    const heading = screen.getByRole('heading', { name: /Section 2 of 4/i });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveFocus();
  });

  it('renders "Finish setup" instead of "Next section" on Section 4', () => {
    localStorage.setItem(
      'setupWizard.progress.v1',
      JSON.stringify({
        currentSection: 4,
        sectionStatus: {
          1: 'completed',
          2: 'completed',
          3: 'completed',
          4: 'pending',
        },
        startedAt: '2026-05-26T12:00:00Z',
      }),
    );
    render(
      <MemoryRouter>
        <SectionLayout />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole('button', { name: /next section/i }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: /finish setup/i }),
    ).toBeInTheDocument();
  });

  // A tiny probe that renders the current pathname so we can assert where
  // handleFinish navigated.
  function LocationProbe() {
    const { pathname } = useLocation();
    return <div data-testid="pathname">{pathname}</div>;
  }

  function renderAtSection4() {
    localStorage.setItem(
      'setupWizard.progress.v1',
      JSON.stringify({
        currentSection: 4,
        sectionStatus: {
          1: 'completed',
          2: 'completed',
          3: 'completed',
          4: 'in_progress',
        },
        startedAt: '2026-05-26T12:00:00Z',
      }),
    );
    return render(
      <MemoryRouter initialEntries={['/setup']}>
        <Routes>
          <Route path="/setup" element={<SectionLayout />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('handleFinish navigates to /welcome when Tailor is NOT done (new user)', async () => {
    const user = userEvent.setup();
    // Tailor marker absent → onboarding flow runs.
    renderAtSection4();
    await user.click(screen.getByRole('button', { name: /finish setup/i }));
    expect(screen.getByTestId('pathname').textContent).toBe('/welcome');
  });

  it('handleFinish navigates to / when Tailor is ALREADY done (existing user via /setup?section=4)', async () => {
    const user = userEvent.setup();
    markTailorDone(); // guard: existing user re-entering the wizard skips onboarding
    renderAtSection4();
    await user.click(screen.getByRole('button', { name: /finish setup/i }));
    expect(screen.getByTestId('pathname').textContent).toBe('/');
  });
});
