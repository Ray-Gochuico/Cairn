import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAccountsStore } from '@/stores/accounts-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import Section2_WhatYouOwn from '@/pages/setup/Section2_WhatYouOwn';

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
  useHoldingsStore.setState({ holdings: [], ...base } as any);
  usePropertiesStore.setState({ properties: [], ...base } as any);
  useVehiclesStore.setState({ vehicles: [], ...base } as any);
  useEquityGrantsStore.setState({ equityGrants: [], ...base } as any);
  usePersonsStore.setState({ persons: [{ id: 1, name: 'Alice' }], ...base } as any);
  useLoansStore.setState({ loans: [], ...base } as any);
}

describe('Section2_WhatYouOwn', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the entry gate when status is pending', () => {
    render(
      <Section2_WhatYouOwn status="pending" onSetStatus={() => {}} />,
    );
    expect(screen.getByText(/Your assets/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /start this section/i }),
    ).toBeInTheDocument();
  });

  it('renders the five cards when status is in_progress', () => {
    render(
      <Section2_WhatYouOwn status="in_progress" onSetStatus={() => {}} />,
    );
    expect(screen.getByText(/^Accounts$/)).toBeInTheDocument();
    expect(screen.getByText(/^Holdings$/)).toBeInTheDocument();
    expect(screen.getByText(/^Properties$/)).toBeInTheDocument();
    expect(screen.getByText(/^Vehicles$/)).toBeInTheDocument();
    expect(screen.getByText(/^Equity grants$/i)).toBeInTheDocument();
  });

  it('clicking Start this section flips status to in_progress', async () => {
    const user = userEvent.setup();
    const onSetStatus = vi.fn();
    render(
      <Section2_WhatYouOwn status="pending" onSetStatus={onSetStatus} />,
    );
    await user.click(
      screen.getByRole('button', { name: /start this section/i }),
    );
    expect(onSetStatus).toHaveBeenCalledWith('in_progress');
  });

  it('clicking Skip flips status to skipped', async () => {
    const user = userEvent.setup();
    const onSetStatus = vi.fn();
    render(
      <Section2_WhatYouOwn status="pending" onSetStatus={onSetStatus} />,
    );
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSetStatus).toHaveBeenCalledWith('skipped');
  });
});
