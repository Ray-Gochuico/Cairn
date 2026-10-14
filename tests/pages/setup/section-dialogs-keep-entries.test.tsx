import { describe, it, expect, beforeEach, vi } from 'vitest';

// Section 4 mounts TransactionsSectionImporter → the PDF pipeline; mock
// before imports, verbatim from Section4_History.test.tsx.
vi.mock('@/pdf/extract', () => ({
  extractTextItems: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/pdf/parse-statement', () => ({
  parseStatement: vi.fn().mockReturnValue({ issuer: 'GENERIC', transactions: [] }),
}));
vi.mock('@/lib/statements-archive', () => ({
  archiveStatementPdf: vi.fn().mockResolvedValue(null),
  resolveArchivePath: vi.fn(),
}));

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentType } from 'react';
import Section1_WhoYouAre from '@/pages/setup/Section1_WhoYouAre';
import Section2_WhatYouOwn from '@/pages/setup/Section2_WhatYouOwn';
import Section3_WhatYouOwe from '@/pages/setup/Section3_WhatYouOwe';
import Section4_History from '@/pages/setup/Section4_History';
import type { SectionStatus } from '@/pages/setup/sections';
import { useAccountsStore } from '@/stores/accounts-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useGoalsStore } from '@/stores/goals-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { makeAccount, makeHousehold, makePerson, makeProperty } from '../../factories';

/**
 * v1.8.0 O2 (RC2, CR-O-3): every /setup form-view dialog keeps what the user
 * entered: an overlay pointer-down never closes it, and Escape asks once
 * something was typed (o-rca.json RC2: "17 onOpenChange sites in
 * Section1-4"). The form view is reachable from the worded flow through
 * "Switch to form view" (FlowShell.tsx:303).
 */

const ASK = 'Discard unsaved entries?';

type SectionProps = {
  status: SectionStatus;
  onSetStatus: (s: SectionStatus) => void;
  hasData: boolean;
  settled: boolean;
};

const writeSpy = vi.fn(async () => 7);

beforeEach(() => {
  vi.clearAllMocks();
  const base = {
    isLoading: false, error: null, load: async () => {},
    create: writeSpy, update: writeSpy, remove: async () => {},
  };
  useHouseholdStore.setState({
    // MFJ ≠ the form's SINGLE default: opening the Household dialog fires the
    // Radix Select hydration echo (house gotcha), which must not count.
    household: makeHousehold({ filingStatus: 'MFJ' }),
    isLoading: false, error: null, load: async () => {}, update: writeSpy, acceptDisclaimer: async () => {},
  } as never);
  usePersonsStore.setState({
    persons: [makePerson({ id: 1, name: 'Alice', employmentType: 'SALARY_NO_OT', annualSalaryPretax: 0 })],
    ...base,
  } as never);
  useTaxRulesStore.setState({ items: [], isLoading: false, error: null, loadYear: async () => {} } as never);
  useDependentsStore.setState({ dependents: [], ...base } as never);
  useAccountsStore.setState({ accounts: [makeAccount({ id: 1, name: 'Joint checking' })], ...base, createWithAnswers: writeSpy } as never);
  useHoldingsStore.setState({ holdings: [], ...base } as never);
  usePropertiesStore.setState({ properties: [makeProperty({ id: 1, name: 'Home' })], ...base } as never);
  useVehiclesStore.setState({ vehicles: [], ...base } as never);
  useHousingPaymentsStore.setState({ housingPayments: [], ...base } as never);
  useVehicleLeasesStore.setState({ vehicleLeases: [], ...base } as never);
  useEquityGrantsStore.setState({ equityGrants: [], ...base } as never);
  useLoansStore.setState({ loans: [], ...base } as never);
  useCategoriesStore.setState({ categories: [], ...base } as never);
  useSnapshotsStore.setState({ snapshots: [], ...base, upsert: writeSpy } as never);
  useTransactionsStore.setState({ transactions: [], ...base } as never);
  useContributionsStore.setState({ contributions: [], ...base } as never);
  useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], ...base, removeForOwner: async () => {} } as never);
  useGoalsStore.setState({ goals: [], ...base } as never);
  useSettingsStore.setState({ settings: null, ...base } as never);
});

/** Radix adds its document pointerdown listener on a setTimeout(0). */
async function settleRadixListeners() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

function overlay(): Element {
  const el = document.querySelector('[data-state="open"].fixed.inset-0');
  if (!el) throw new Error('no open overlay');
  return el;
}

/** Every form-view dialog (`grep -n "onOpenChange" src/pages/setup/Section*.tsx`), at f5f354e9. */
const CASES: Array<{
  site: string;
  Section: ComponentType<SectionProps>;
  open: string;
  title: string;
  field: string;
}> = [
  { site: 'Section1_WhoYouAre.tsx:161', Section: Section1_WhoYouAre, open: 'entity-card-household', title: 'Household', field: 'Household name (optional)' },
  { site: 'Section1_WhoYouAre.tsx:175', Section: Section1_WhoYouAre, open: 'entity-card-persons', title: 'Add a person', field: 'Name' },
  { site: 'Section1_WhoYouAre.tsx:189', Section: Section1_WhoYouAre, open: 'Edit Alice', title: 'Edit person', field: 'Name' },
  { site: 'Section1_WhoYouAre.tsx:213', Section: Section1_WhoYouAre, open: 'entity-card-employment', title: 'Employment', field: 'Annual salary (pre-tax)' },
  { site: 'Section1_WhoYouAre.tsx:227', Section: Section1_WhoYouAre, open: 'entity-card-dependents', title: 'Add a dependent', field: 'Name' },
  { site: 'Section2_WhatYouOwn.tsx:208', Section: Section2_WhatYouOwn, open: 'entity-card-accounts', title: 'Add an account', field: 'Name' },
  { site: 'Section2_WhatYouOwn.tsx:222', Section: Section2_WhatYouOwn, open: 'entity-card-holdings', title: 'Add a holding', field: 'ticker' },
  { site: 'Section2_WhatYouOwn.tsx:236', Section: Section2_WhatYouOwn, open: 'entity-card-properties', title: 'Add a property', field: 'Name' },
  { site: 'Section2_WhatYouOwn.tsx:250', Section: Section2_WhatYouOwn, open: 'entity-card-rent-housing-payment', title: 'Add rent / housing payment', field: 'Label' },
  { site: 'Section2_WhatYouOwn.tsx:264', Section: Section2_WhatYouOwn, open: 'entity-card-vehicles', title: 'Add a vehicle', field: 'Name' },
  { site: 'Section2_WhatYouOwn.tsx:278', Section: Section2_WhatYouOwn, open: 'entity-card-vehicle-lease', title: 'Add vehicle lease', field: 'Label' },
  { site: 'Section2_WhatYouOwn.tsx:292', Section: Section2_WhatYouOwn, open: 'entity-card-equity-grants', title: 'Add an equity grant', field: 'Name' },
  { site: 'Section3_WhatYouOwe.tsx:78', Section: Section3_WhatYouOwe, open: 'entity-card-loans', title: 'Add a loan', field: 'Name' },
  { site: 'Section4_History.tsx:222', Section: Section4_History, open: 'entity-card-account-snapshots', title: 'Add account snapshot', field: 'Total value' },
  { site: 'Section4_History.tsx:243', Section: Section4_History, open: 'entity-card-property-vehicle-values', title: 'Add property / vehicle value snapshot', field: 'Value' },
  { site: 'Section4_History.tsx:261', Section: Section4_History, open: 'entity-card-contributions', title: 'Add contribution', field: 'Amount' },
  { site: 'Section4_History.tsx:282', Section: Section4_History, open: 'entity-card-goals', title: 'Add a goal', field: 'Name' },
];

async function openSectionDialog(c: (typeof CASES)[number]) {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <c.Section hasData settled status="in_progress" onSetStatus={() => {}} />
    </MemoryRouter>,
  );
  const opener = c.open.startsWith('entity-card-')
    ? within(screen.getByTestId(c.open)).getByRole('button', { name: 'Add manually' })
    : screen.getByRole('button', { name: c.open });
  await user.click(opener);
  const dialog = await screen.findByRole('dialog', { name: c.title });
  const field = within(dialog).getByLabelText(c.field) as HTMLInputElement;
  return { user, dialog, field };
}

/** A value each field accepts (the number fields refuse letters). */
async function typeInto(user: ReturnType<typeof userEvent.setup>, field: HTMLInputElement) {
  await user.clear(field);
  await user.type(field, field.type === 'number' ? '4200' : 'Pat Rivera');
  return field.type === 'number' ? '4200' : 'Pat Rivera';
}

describe.each(CASES)('form-view dialog $site ($title)', (c) => {
  it('a pointer-down on the overlay keeps the dialog and the typed value', async () => {
    const { user, field } = await openSectionDialog(c);
    const typed = await typeInto(user, field);
    await settleRadixListeners();
    fireEvent.pointerDown(overlay());
    const still = screen.getByRole('dialog', { name: c.title });
    expect((within(still).getByLabelText(c.field) as HTMLInputElement).value).toBe(typed);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('Escape on the typed field asks first; Stay keeps the value and the focus', async () => {
    const { user, field } = await openSectionDialog(c);
    const typed = await typeInto(user, field);
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: ASK })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    const still = screen.getByRole('dialog', { name: c.title });
    expect((within(still).getByLabelText(c.field) as HTMLInputElement).value).toBe(typed);
    await waitFor(() => expect(document.activeElement).toBe(within(still).getByLabelText(c.field)));
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('form-view dialogs — pristine Escape and the Radix Select', () => {
  it('Household (MFJ, so its Filing status hydrates on open): Escape on the untouched dialog closes it at once', async () => {
    const { user } = await openSectionDialog(CASES[0]);
    expect(screen.getByRole('combobox', { name: 'Filing status' })).toHaveTextContent('Married Filing Jointly');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Household' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
  });

  it('Household: a Filing status pick alone makes Escape ask; Stay keeps the pick', async () => {
    const { user } = await openSectionDialog(CASES[0]);
    await user.click(screen.getByRole('combobox', { name: 'Filing status' }));
    await user.click(await screen.findByRole('option', { name: 'Head of Household' }));
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: ASK })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.getByRole('combobox', { name: 'Filing status' })).toHaveTextContent('Head of Household');
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
