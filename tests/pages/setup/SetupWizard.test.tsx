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

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';
import type { Household } from '@/types/schema';
import { DISCLOSURES } from '@/legal/disclosures';
import SetupWizard from '@/pages/setup/SetupWizard';

function makeHousehold(patch: Partial<Household> = {}): Household {
  return {
    id: 1,
    name: null,
    filingStatus: FilingStatus.SINGLE,
    state: 'CA',
    city: null,
    monthlyExpenseBaseline: 5000,
    withdrawalRate: 0.04,
    inflationAssumption: 0.024,
    growthScenarios: [],
    disclaimerAcceptedAt: null,
    disclaimerVersionAccepted: null,
    roadmapDisclaimerAcceptedAt: null,
    roadmapDisclaimerVersionAccepted: null,
    interestThresholdLowPct: null,
    interestThresholdHighPct: null,
    hasWrittenIps: null,
    hasHsaQualifiedHdhp: null,
    makesCharitableGifts: null,
    upcomingLargePurchase: null,
    upcomingPurchaseAmount: null,
    upcomingPurchaseMonths: null,
    ...patch,
  };
}

function resetStores(opts: {
  household?: Household | null;
  persons?: Array<{ id: number; name: string }>;
} = {}) {
  useHouseholdStore.setState({
    household: opts.household ?? null,
    isLoading: false,
    error: null,
    load: async () => {},
    update: async () => {},
    acceptDisclaimer: async () => {},
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
      household: makeHousehold({
        disclaimerAcceptedAt: '2026-01-01',
        disclaimerVersionAccepted: DISCLOSURES.app_wide.version,
      }),
    });
    renderAt(['/setup']);
    expect(
      screen.getByRole('heading', { name: /Section 1 of 4/i }),
    ).toBeInTheDocument();
  });

  it('?section=4 jumps to Section 4 when persons exist (existing household)', () => {
    resetStores({
      household: makeHousehold({
        disclaimerAcceptedAt: '2026-01-01',
        disclaimerVersionAccepted: DISCLOSURES.app_wide.version,
      }),
      persons: [{ id: 1, name: 'Alice' }],
    });
    renderAt(['/setup?section=4']);
    expect(
      screen.getByRole('heading', { name: /Section 4 of 4/i }),
    ).toBeInTheDocument();
  });

  it('?section=4 is IGNORED when persons-store is empty (fresh user)', () => {
    renderAt(['/setup?section=4']);
    expect(
      screen.getByRole('heading', { name: /disclaimer/i }),
    ).toBeInTheDocument();
  });

  it('?section=4 with persons skips the disclaimer even if not yet accepted', () => {
    resetStores({
      household: makeHousehold(),
      persons: [{ id: 1, name: 'Alice' }],
    });
    renderAt(['/setup?section=4']);
    expect(
      screen.getByRole('heading', { name: /Section 4 of 4/i }),
    ).toBeInTheDocument();
  });
});
