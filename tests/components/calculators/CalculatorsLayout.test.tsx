import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CalculatorsLayout from '@/pages/calculators/CalculatorsLayout';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useLoansStore } from '@/stores/loans-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';

describe('CalculatorsLayout', () => {
  beforeEach(() => {
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
  });

  // Cold-boot / deep-link safety: landing on /calculators (boot → Dashboard →
  // Calculators, or a deep-link) must hydrate persons + dependents for the whole
  // grid — the Dashboard landing page loads 13 stores but NOT these, so without
  // the layout's bootstrap effect every card shows its empty "add a person"
  // state despite real data in the DB. Goes RED if the bootstrap is removed.
  it('hydrates persons + dependents on mount', () => {
    const personsLoad = vi.spyOn(usePersonsStore.getState(), 'load').mockResolvedValue(undefined);
    const dependentsLoad = vi
      .spyOn(useDependentsStore.getState(), 'load')
      .mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <CalculatorsLayout />
      </MemoryRouter>,
    );

    expect(personsLoad).toHaveBeenCalled();
    expect(dependentsLoad).toHaveBeenCalled();

    personsLoad.mockRestore();
    dependentsLoad.mockRestore();
  });

  // Cold-boot hydration for FI/CoastFI/Debt/Equity portfolio stores: a user
  // deep-linking directly to /calculators would see $0 in FI, Debt Payoff, and
  // Equity Value cards unless these stores are also loaded here. Goes RED if
  // the bootstrap is missing or incomplete.
  it('hydrates snapshots, contributions, loans, and equity-grants on mount', () => {
    const snapshotsLoad = vi
      .spyOn(useSnapshotsStore.getState(), 'load')
      .mockResolvedValue(undefined);
    const contributionsLoad = vi
      .spyOn(useContributionsStore.getState(), 'load')
      .mockResolvedValue(undefined);
    const loansLoad = vi
      .spyOn(useLoansStore.getState(), 'load')
      .mockResolvedValue(undefined);
    const equityGrantsLoad = vi
      .spyOn(useEquityGrantsStore.getState(), 'load')
      .mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <CalculatorsLayout />
      </MemoryRouter>,
    );

    expect(snapshotsLoad).toHaveBeenCalledOnce();
    expect(contributionsLoad).toHaveBeenCalledOnce();
    expect(loansLoad).toHaveBeenCalledOnce();
    expect(equityGrantsLoad).toHaveBeenCalledOnce();

    snapshotsLoad.mockRestore();
    contributionsLoad.mockRestore();
    loansLoad.mockRestore();
    equityGrantsLoad.mockRestore();
  });
});
