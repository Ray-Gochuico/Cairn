import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import Section3_WhatYouOwe from '@/pages/setup/Section3_WhatYouOwe';

function resetStores() {
  const base = {
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  };
  useLoansStore.setState({ loans: [], ...base } as any);
  usePersonsStore.setState({
    persons: [{ id: 1, name: 'Alice' }],
    ...base,
  } as any);
  usePropertiesStore.setState({ properties: [], ...base } as any);
  useVehiclesStore.setState({ vehicles: [], ...base } as any);
}

describe('Section3_WhatYouOwe', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the entry gate when status is pending', () => {
    render(
      <Section3_WhatYouOwe status="pending" onSetStatus={() => {}} />,
    );
    expect(screen.getByText(/Your debts/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /start this section/i }),
    ).toBeInTheDocument();
  });

  it('renders the Loans card when status is in_progress', () => {
    render(
      <Section3_WhatYouOwe status="in_progress" onSetStatus={() => {}} />,
    );
    expect(screen.getByText(/^Loans$/)).toBeInTheDocument();
  });

  it('clicking Skip flips status to skipped', async () => {
    const user = userEvent.setup();
    const onSetStatus = vi.fn();
    render(
      <Section3_WhatYouOwe status="pending" onSetStatus={onSetStatus} />,
    );
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSetStatus).toHaveBeenCalledWith('skipped');
  });

  it('clicking Add manually on the Loans card opens the LoanForm dialog', async () => {
    const user = userEvent.setup();
    render(
      <Section3_WhatYouOwe status="in_progress" onSetStatus={() => {}} />,
    );
    await user.click(
      screen.getByRole('button', { name: /add manually/i }),
    );
    expect(
      await screen.findByRole('button', { name: /add loan/i }),
    ).toBeInTheDocument();
  });
});
