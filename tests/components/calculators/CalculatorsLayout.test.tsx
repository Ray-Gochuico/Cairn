import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CalculatorsLayout from '@/pages/calculators/CalculatorsLayout';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';

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
});
