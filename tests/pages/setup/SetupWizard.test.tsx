import { describe, it, expect, beforeEach, vi } from 'vitest';

// Section 4 mounts TransactionsSectionImporter, which pulls in the PDF
// extract + parse pipeline. Mock both so SetupWizard can render without
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

import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import type { Household } from '@/types/schema';
import { DISCLOSURES } from '@/legal/disclosures';
import SetupWizard from '@/pages/setup/SetupWizard';
import { makeHousehold } from '../../factories';


function resetStores(opts: {
  household?: Household | null;
  persons?: Array<{ id: number; name: string }>;
  // The wizard reads app_wide acceptance from the acceptances projection
  // (single source of truth, MF-1), not a household column. Seed it here.
  appWideAccepted?: string;
} = {}) {
  useHouseholdStore.setState({
    household: opts.household ?? null,
    isLoading: false,
    error: null,
    load: async () => {},
    update: async () => {},
    acceptDisclaimer: async () => {},
  } as any);
  useAcceptancesStore.setState({
    acceptedVersions: opts.appWideAccepted ? { app_wide: opts.appWideAccepted } : {},
    status: 'ready',
    isLoading: false,
    error: null,
    load: async () => {},
  } as any);
  usePersonsStore.setState({
    persons: opts.persons ?? [],
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  } as any);
  useDependentsStore.setState({
    dependents: [],
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  } as any);
  useTaxRulesStore.setState({
    items: [],
    isLoading: false,
    error: null,
    loadYear: async () => {},
  } as any);
}

function renderAt(entries: string[]) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SetupWizard route handler', () => {
  beforeEach(() => {
    resetStores();
    localStorage.clear();
  });

  it('renders Step0Disclaimer first on a fresh visit (no persons, no acceptance)', () => {
    renderAt(['/setup']);
    expect(
      screen.getByRole('heading', { name: /disclaimer/i }),
    ).toBeInTheDocument();
  });

  it('mounts SectionLayout at Section 1 when the disclaimer is already accepted', () => {
    resetStores({
      household: makeHousehold({ inflationAssumption: 0.024 }),
      appWideAccepted: DISCLOSURES.app_wide.version,
    });
    renderAt(['/setup']);
    expect(
      screen.getByRole('heading', { name: /Section 1 of 4/i }),
    ).toBeInTheDocument();
  });

  it('?section=4 jumps to Section 4 when persons exist (existing household)', () => {
    resetStores({
      household: makeHousehold({ inflationAssumption: 0.024 }),
      appWideAccepted: DISCLOSURES.app_wide.version,
      persons: [{ id: 1, name: 'Alice' }],
    });
    renderAt(['/setup?section=4']);
    expect(
      screen.getByRole('heading', { name: /Section 4 of 4/i }),
    ).toBeInTheDocument();
  });

  it('waits for persons to load, then honors ?section=4 for a returning household (W10 M47)', async () => {
    resetStores({
      household: makeHousehold({ inflationAssumption: 0.024 }),
      appWideAccepted: DISCLOSURES.app_wide.version,
    });
    // Persons IN FLIGHT on first render — the old code dropped the param here.
    usePersonsStore.setState({ persons: [], isLoading: true, error: null, load: async () => {} } as any);
    renderAt(['/setup?section=4']);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    // Loads resolve with an existing household:
    act(() => {
      usePersonsStore.setState({ persons: [{ id: 1, name: 'Alice' }], isLoading: false } as any);
    });
    expect(await screen.findByRole('heading', { name: /Section 4 of 4/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Section 1 of 4/i })).not.toBeInTheDocument();
  });

  it('?section=4 is IGNORED when persons-store is empty (fresh user)', () => {
    renderAt(['/setup?section=4']);
    expect(
      screen.getByRole('heading', { name: /disclaimer/i }),
    ).toBeInTheDocument();
  });

  it('?section=4 with persons skips the disclaimer even if not yet accepted', () => {
    resetStores({
      household: makeHousehold({ inflationAssumption: 0.024 }),
      persons: [{ id: 1, name: 'Alice' }],
    });
    renderAt(['/setup?section=4']);
    expect(
      screen.getByRole('heading', { name: /Section 4 of 4/i }),
    ).toBeInTheDocument();
  });
});
