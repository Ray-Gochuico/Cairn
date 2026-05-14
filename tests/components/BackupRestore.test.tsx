import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import BackupRestore from '@/pages/BackupRestore';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useLoansStore } from '@/stores/loans-store';
import { useLoanPaymentsStore } from '@/stores/loan-payments-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';

function resetAllStores() {
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  useHoldingsStore.setState({ holdings: [], isLoading: false, error: null });
  useContributionsStore.setState({ contributions: [], isLoading: false, error: null });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  useLoansStore.setState({ loans: [], isLoading: false, error: null });
  useLoanPaymentsStore.setState({ payments: [], isLoading: false, error: null });
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null });
}

describe('BackupRestore', () => {
  beforeEach(() => {
    resetAllStores();
  });

  it('renders Export and Restore buttons', () => {
    render(
      <MemoryRouter>
        <BackupRestore />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('button', { name: /export to json/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /restore from json/i }),
    ).toBeInTheDocument();
  });

  it('renders a hidden file input for restore', () => {
    const { container } = render(
      <MemoryRouter>
        <BackupRestore />
      </MemoryRouter>,
    );
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input?.getAttribute('accept')).toContain('json');
  });

  it('clicking Export does not crash and shows a success message', async () => {
    // jsdom supports URL.createObjectURL / Blob; the anchor click is a no-op
    // in jsdom, so we just need to verify the path doesn't throw.
    const createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-url');
    const revokeObjectURLSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});

    render(
      <MemoryRouter>
        <BackupRestore />
      </MemoryRouter>,
    );

    const exportBtn = screen.getByRole('button', { name: /export to json/i });
    await userEvent.click(exportBtn);

    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalled();
    expect(await screen.findByText(/exported/i)).toBeInTheDocument();

    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });

  it('shows confirmation modal after a valid backup file is loaded', async () => {
    render(
      <MemoryRouter>
        <BackupRestore />
      </MemoryRouter>,
    );

    const validBackup = {
      version: 1,
      exportedAt: '2026-05-14T00:00:00Z',
      household: null,
      persons: [],
      dependents: [],
      accounts: [],
      holdings: [],
      contributions: [],
      account_snapshots: [],
      loans: [],
      loan_payments: [],
      properties: [],
      vehicles: [],
      equity_grants: [],
      goals: [],
    };
    const file = new File([JSON.stringify(validBackup)], 'backup.json', {
      type: 'application/json',
    });

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await userEvent.upload(input, file);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/replace all your current data/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^restore$/i })).toBeInTheDocument();
  });

  it('Cancel button closes the confirmation modal', async () => {
    render(
      <MemoryRouter>
        <BackupRestore />
      </MemoryRouter>,
    );

    const validBackup = {
      version: 1,
      exportedAt: '2026-05-14T00:00:00Z',
      household: null,
      persons: [],
      dependents: [],
      accounts: [],
      holdings: [],
      contributions: [],
      account_snapshots: [],
      loans: [],
      loan_payments: [],
      properties: [],
      vehicles: [],
      equity_grants: [],
      goals: [],
    };
    const file = new File([JSON.stringify(validBackup)], 'backup.json', {
      type: 'application/json',
    });

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await userEvent.upload(input, file);

    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an error message when an invalid file is selected', async () => {
    render(
      <MemoryRouter>
        <BackupRestore />
      </MemoryRouter>,
    );

    const file = new File(['this is not valid json {{{'], 'bad.json', {
      type: 'application/json',
    });

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await userEvent.upload(input, file);

    expect(await screen.findByText(/invalid backup file/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Restore confirm button calls the apply stub (logs warning, no destructive action)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <MemoryRouter>
        <BackupRestore />
      </MemoryRouter>,
    );

    const validBackup = {
      version: 1,
      exportedAt: '2026-05-14T00:00:00Z',
      household: null,
      persons: [],
      dependents: [],
      accounts: [],
      holdings: [],
      contributions: [],
      account_snapshots: [],
      loans: [],
      loan_payments: [],
      properties: [],
      vehicles: [],
      equity_grants: [],
      goals: [],
    };
    const file = new File([JSON.stringify(validBackup)], 'backup.json', {
      type: 'application/json',
    });

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await userEvent.upload(input, file);

    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /^restore$/i }));

    expect(warnSpy).toHaveBeenCalled();
    // Modal should close after applying.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // A success message should appear.
    expect(await screen.findByText(/restore.*completed|restored/i)).toBeInTheDocument();

    warnSpy.mockRestore();
  });
});
