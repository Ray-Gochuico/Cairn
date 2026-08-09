import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createRef } from 'react';
import AccountsGateStep from '@/pages/setup/flow/steps/AccountsGateStep';
import type { StepSaveResult, FlowCtx } from '@/domain/setup-flow/types';
import { defaultProgressV2 } from '@/lib/setup-progress';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { makeAccount, makeHousehold } from '../../../factories';

const accountsCreate = vi.fn(async () => 5);
const accountsUpdate = vi.fn(async () => {});
const snapshotsUpsert = vi.fn(async () => 9);

function ctxWith(overrides: Partial<FlowCtx> = {}): FlowCtx {
  return {
    household: makeHousehold(), persons: [], dependents: [], accounts: [], properties: [],
    housingPayments: [], vehicles: [], vehicleLeases: [], equityGrants: [], loans: [],
    transactions: [], goals: [], progress: defaultProgressV2(), todayIso: '2026-08-09',
    ...overrides,
  };
}

function renderStep(ctx: FlowCtx) {
  const submitRef = createRef<(() => Promise<StepSaveResult>) | null>() as
    React.MutableRefObject<(() => Promise<StepSaveResult>) | null>;
  render(
    <MemoryRouter>
      <AccountsGateStep ctx={ctx} asked={false} onDirtyChange={vi.fn()} submitRef={submitRef} />
    </MemoryRouter>,
  );
  return { submitRef };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAccountsStore.setState({
    accounts: [], isLoading: false, error: null,
    create: accountsCreate, update: accountsUpdate, load: async () => {},
  } as never);
  useSnapshotsStore.setState({
    snapshots: [], isLoading: false, error: null,
    upsert: snapshotsUpsert, load: async () => {},
  } as never);
});

describe('AccountsGateStep', () => {
  it('Yes reveals the Accounts card; existing accounts render as chips', async () => {
    const user = userEvent.setup();
    renderStep(ctxWith({ accounts: [makeAccount({ id: 1, name: 'Joint checking' })] }));
    // Data forces yes (gate honesty) — the card is already revealed.
    expect(screen.getByText('Accounts')).toBeInTheDocument();
    expect(screen.getByText('Joint checking')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeChecked();
    // And an empty gate reveals on an explicit Yes:
    void user;
  });

  it('an empty gate reveals the card on Yes only', async () => {
    const user = userEvent.setup();
    renderStep(ctxWith());
    expect(screen.queryByText('Accounts')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(screen.getByText('Accounts')).toBeInTheDocument();
  });

  it('the create dialog carries the CW-36 balance field above the canonical form', async () => {
    const user = userEvent.setup();
    renderStep(ctxWith());
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: /add manually/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Current balance — optional')).toBeInTheDocument();
    expect(
      within(dialog).getByText("Saved as today's balance snapshot for this account."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add Account' })).toBeInTheDocument();
  });

  it('submitting the form runs the three-write sequence with the entered balance', async () => {
    const user = userEvent.setup();
    renderStep(ctxWith());
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: /add manually/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Current balance — optional'), '12500');
    await user.type(within(dialog).getByLabelText('Name', { exact: true }), 'Joint checking');
    await user.click(within(dialog).getByRole('button', { name: 'Add Account' }));
    await vi.waitFor(() => expect(accountsCreate).toHaveBeenCalledTimes(1));
    expect(accountsCreate.mock.calls[0][0]).toMatchObject({ name: 'Joint checking' });
    expect(accountsUpdate).toHaveBeenCalledWith(5, {
      hasEmployerMatch: null, employerMatchPct: null, employerMatchLimitPct: null,
    });
    expect(snapshotsUpsert).toHaveBeenCalledWith({
      accountId: 5, snapshotDate: '2026-08-09', totalValue: 12500, source: 'MANUAL',
    });
  });
});
