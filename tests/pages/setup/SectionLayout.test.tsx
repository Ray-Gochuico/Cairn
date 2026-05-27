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

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SectionLayout from '@/pages/setup/SectionLayout';

describe('SectionLayout', () => {
  beforeEach(() => {
    localStorage.clear();
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
});
