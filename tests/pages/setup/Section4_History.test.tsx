import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAccountsStore } from '@/stores/accounts-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useGoalsStore } from '@/stores/goals-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import Section4_History from '@/pages/setup/Section4_History';

function resetStores() {
  const base = {
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  };
  useAccountsStore.setState({ accounts: [], ...base } as any);
  useSnapshotsStore.setState({
    snapshots: [],
    ...base,
    upsert: async () => 1,
    refresh: async () => {},
  } as any);
  useContributionsStore.setState({ contributions: [], ...base } as any);
  useAssetValueSnapshotsStore.setState({
    assetValueSnapshots: [],
    ...base,
    removeForOwner: async () => {},
  } as any);
  usePropertiesStore.setState({ properties: [], ...base } as any);
  useVehiclesStore.setState({ vehicles: [], ...base } as any);
  useGoalsStore.setState({ goals: [], ...base } as any);
  usePersonsStore.setState({
    persons: [{ id: 1, name: 'Alice' }],
    ...base,
  } as any);
}

function renderWithRouter(initialEntries: string[] = ['/setup']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route
          path="/setup"
          element={
            <Section4_History status="in_progress" onSetStatus={() => {}} />
          }
        />
        <Route path="/spending" element={<div>Spending page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Section4_History', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the entry gate when status is pending', () => {
    render(
      <MemoryRouter>
        <Section4_History status="pending" onSetStatus={() => {}} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/Your history and goals/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /start this section/i }),
    ).toBeInTheDocument();
  });

  it('renders the five cards when status is in_progress', () => {
    renderWithRouter();
    expect(screen.getByText(/Account snapshots/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Property \/ vehicle values/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Contributions$/)).toBeInTheDocument();
    expect(screen.getByText(/^Transactions$/)).toBeInTheDocument();
    expect(screen.getByText(/^Goals$/)).toBeInTheDocument();
  });

  it('clicking Add manually on the Transactions card navigates to /spending', async () => {
    const user = userEvent.setup();
    renderWithRouter();
    // Five Add manually buttons exist; find the one inside the
    // Transactions card via its heading.
    const transactionsHeading = screen.getByText(/^Transactions$/);
    const transactionsCard = transactionsHeading.closest(
      'div[class*="rounded"]',
    );
    expect(transactionsCard).not.toBeNull();
    const addBtn = transactionsCard!.querySelector(
      'button',
    ) as HTMLButtonElement | null;
    expect(addBtn).not.toBeNull();
    // The card has multiple buttons; navigate-trigger is the "Add
    // manually" one.
    const buttons = Array.from(
      (transactionsCard as HTMLElement).querySelectorAll('button'),
    );
    const addManually = buttons.find((b) =>
      /add manually/i.test(b.textContent ?? ''),
    );
    expect(addManually).toBeTruthy();
    await user.click(addManually!);
    expect(screen.getByText('Spending page')).toBeInTheDocument();
  });

  it('clicking Skip flips status to skipped', async () => {
    const user = userEvent.setup();
    const onSetStatus = vi.fn();
    render(
      <MemoryRouter>
        <Section4_History status="pending" onSetStatus={onSetStatus} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSetStatus).toHaveBeenCalledWith('skipped');
  });
});
