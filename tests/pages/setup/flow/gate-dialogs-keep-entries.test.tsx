import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createRef, type ComponentType } from 'react';
import AccountsGateStep from '@/pages/setup/flow/steps/AccountsGateStep';
import DependentsGateStep from '@/pages/setup/flow/steps/DependentsGateStep';
import EquityGateStep from '@/pages/setup/flow/steps/EquityGateStep';
import GoalsGateStep from '@/pages/setup/flow/steps/GoalsGateStep';
import HomeGateStep from '@/pages/setup/flow/steps/HomeGateStep';
import LoansGateStep from '@/pages/setup/flow/steps/LoansGateStep';
import RentGateStep from '@/pages/setup/flow/steps/RentGateStep';
import VehiclesGateStep from '@/pages/setup/flow/steps/VehiclesGateStep';
import type { StepComponentProps } from '@/pages/setup/flow/step-props';
import type { StepSaveResult, FlowCtx } from '@/domain/setup-flow/types';
import { defaultProgressV2 } from '@/lib/setup-progress';
import { useAccountsStore } from '@/stores/accounts-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useGoalsStore } from '@/stores/goals-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { makeHousehold, makePerson } from '../../../factories';

/**
 * v1.8.0 O2 (RC2, CR-O-3): every worded /setup gate dialog keeps what the
 * user entered. Before, an overlay pointer-down or an Escape closed the
 * dialog and unmounted its form, so a reopen started from the module
 * defaults (o-rca.json RC2, REPRO-WORDED).
 */

const ASK = 'Discard unsaved entries?';

function ctxWith(overrides: Partial<FlowCtx> = {}): FlowCtx {
  return {
    household: makeHousehold(), persons: [], dependents: [], accounts: [], properties: [],
    housingPayments: [], vehicles: [], vehicleLeases: [], equityGrants: [], loans: [],
    transactions: [], goals: [], progress: defaultProgressV2(), todayIso: '2026-08-09',
    ...overrides,
  };
}

function renderStep(Step: ComponentType<StepComponentProps>) {
  const submitRef = createRef<(() => Promise<StepSaveResult>) | null>() as
    React.MutableRefObject<(() => Promise<StepSaveResult>) | null>;
  render(
    <MemoryRouter>
      <Step ctx={ctxWith()} asked={false} onDirtyChange={vi.fn()} submitRef={submitRef} />
    </MemoryRouter>,
  );
}

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

const createSpy = vi.fn(async () => 7);

beforeEach(() => {
  vi.clearAllMocks();
  const base = {
    isLoading: false, error: null, load: async () => {},
    create: createSpy, update: async () => {}, remove: async () => {},
  };
  useAccountsStore.setState({ accounts: [], ...base, createWithAnswers: createSpy } as never);
  useCategoriesStore.setState({ categories: [], ...base } as never);
  useDependentsStore.setState({ dependents: [], ...base } as never);
  useEquityGrantsStore.setState({ equityGrants: [], ...base } as never);
  useGoalsStore.setState({ goals: [], ...base } as never);
  useHousingPaymentsStore.setState({ housingPayments: [], ...base } as never);
  useLoansStore.setState({ loans: [], ...base } as never);
  // PropertyForm, VehicleForm and LoanForm ask for a person first.
  usePersonsStore.setState({ persons: [makePerson({ id: 1, name: 'Alice' })], ...base } as never);
  usePropertiesStore.setState({ properties: [], ...base } as never);
  useSettingsStore.setState({ settings: null, ...base } as never);
  useSnapshotsStore.setState({ snapshots: [], ...base, upsert: vi.fn(async () => 9) } as never);
  useTransactionsStore.setState({ transactions: [], ...base } as never);
  useVehicleLeasesStore.setState({ vehicleLeases: [], ...base } as never);
  useVehiclesStore.setState({ vehicles: [], ...base } as never);
});

/** Every gate dialog in the worded flow (`grep -n "onOpenChange" src/pages/setup/flow/steps`). */
const CASES: Array<{
  site: string;
  Step: ComponentType<StepComponentProps>;
  card?: string;
  title: string;
  field: string;
}> = [
  { site: 'AccountsGateStep.tsx:94', Step: AccountsGateStep, title: 'Add an account', field: 'Name' },
  { site: 'DependentsGateStep.tsx:66', Step: DependentsGateStep, title: 'Add a dependent', field: 'Name' },
  { site: 'HomeGateStep.tsx:51', Step: HomeGateStep, title: 'Add a property', field: 'Name' },
  { site: 'RentGateStep.tsx:50', Step: RentGateStep, title: 'Add rent / housing payment', field: 'Label' },
  { site: 'VehiclesGateStep.tsx:65', Step: VehiclesGateStep, card: 'entity-card-vehicles', title: 'Add a vehicle', field: 'Name' },
  { site: 'VehiclesGateStep.tsx:76', Step: VehiclesGateStep, card: 'entity-card-vehicle-lease', title: 'Add vehicle lease', field: 'Label' },
  { site: 'EquityGateStep.tsx:53', Step: EquityGateStep, title: 'Add an equity grant', field: 'Name' },
  { site: 'LoansGateStep.tsx:58', Step: LoansGateStep, title: 'Add a loan', field: 'Name' },
  { site: 'GoalsGateStep.tsx:48', Step: GoalsGateStep, title: 'Add a goal', field: 'Name' },
];

async function openGateDialog(c: (typeof CASES)[number]) {
  const user = userEvent.setup();
  renderStep(c.Step);
  await user.click(screen.getByRole('radio', { name: 'Yes' }));
  const scope = c.card ? within(screen.getByTestId(c.card)) : screen;
  await user.click(scope.getByRole('button', { name: 'Add manually' }));
  const dialog = await screen.findByRole('dialog', { name: c.title });
  return { user, dialog };
}

describe.each(CASES)('worded gate dialog $site ($title)', (c) => {
  it('a pointer-down on the overlay keeps the dialog and the typed value', async () => {
    const { user, dialog } = await openGateDialog(c);
    await user.type(within(dialog).getByLabelText(c.field), 'Pat Rivera');
    await settleRadixListeners();
    fireEvent.pointerDown(overlay());
    const still = screen.getByRole('dialog', { name: c.title });
    expect((within(still).getByLabelText(c.field) as HTMLInputElement).value).toBe('Pat Rivera');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('Escape on the typed field asks first; Stay keeps the value and the focus', async () => {
    const { user, dialog } = await openGateDialog(c);
    const field = within(dialog).getByLabelText(c.field);
    await user.type(field, 'Pat Rivera');
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: ASK })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    const still = screen.getByRole('dialog', { name: c.title });
    expect((within(still).getByLabelText(c.field) as HTMLInputElement).value).toBe('Pat Rivera');
    await waitFor(() => expect(document.activeElement).toBe(within(still).getByLabelText(c.field)));
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe('worded gate dialogs — the RC2 repro shapes', () => {
  it('Dependents: Escape on the focused Type select after a pick asks; Stay keeps the name and the type', async () => {
    const { user, dialog } = await openGateDialog(CASES[1]);
    await user.type(within(dialog).getByLabelText('Name'), 'Pat Rivera');
    const type = within(dialog).getByLabelText('Type') as HTMLSelectElement;
    await user.selectOptions(type, 'OTHER');
    type.focus();
    await user.keyboard('{Escape}');
    await screen.findByRole('dialog', { name: ASK });
    await user.keyboard('{Escape}');
    const still = screen.getByRole('dialog', { name: 'Add a dependent' });
    expect((within(still).getByLabelText('Name') as HTMLInputElement).value).toBe('Pat Rivera');
    expect((within(still).getByLabelText('Type') as HTMLSelectElement).value).toBe('OTHER');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("Accounts: the balance (FlowAccountCreate's own state) survives an overlay pointer-down and an Escape → Stay with the form", async () => {
    const { user, dialog } = await openGateDialog(CASES[0]);
    await user.type(within(dialog).getByLabelText('Current balance — optional'), '12500');
    await user.type(within(dialog).getByLabelText('Name'), 'Joint checking');
    const type = within(dialog).getByLabelText('Type') as HTMLSelectElement;
    const picked = type.options[type.options.length - 1].value;
    await user.selectOptions(type, picked);
    await settleRadixListeners();
    fireEvent.pointerDown(overlay());
    await user.keyboard('{Escape}');
    await screen.findByRole('dialog', { name: ASK });
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    const still = screen.getByRole('dialog', { name: 'Add an account' });
    expect((within(still).getByLabelText('Current balance — optional') as HTMLInputElement).value).toContain('12,500');
    expect((within(still).getByLabelText('Name') as HTMLInputElement).value).toBe('Joint checking');
    expect((within(still).getByLabelText('Type') as HTMLSelectElement).value).toBe(picked);
  });

  it('Discard entries closes the dialog; Add manually opens an empty one', async () => {
    const { user, dialog } = await openGateDialog(CASES[1]);
    await user.type(within(dialog).getByLabelText('Name'), 'Pat Rivera');
    await user.keyboard('{Escape}');
    await screen.findByRole('dialog', { name: ASK });
    await user.click(screen.getByRole('button', { name: 'Discard entries' }));
    expect(screen.queryByRole('dialog', { name: 'Add a dependent' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add manually' }));
    const fresh = await screen.findByRole('dialog', { name: 'Add a dependent' });
    expect((within(fresh).getByLabelText('Name') as HTMLInputElement).value).toBe('');
    expect(createSpy).not.toHaveBeenCalled();
  });
});
