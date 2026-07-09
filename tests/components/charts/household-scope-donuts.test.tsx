import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AssetsDonut from '@/components/charts/AssetsDonut';
import LiabilitiesDonut from '@/components/charts/LiabilitiesDonut';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useLoansStore } from '@/stores/loans-store';

// W10 T7: AssetsDonut / LiabilitiesDonut are household-wide by design. Under a
// person view they flag that with a "· Household" title suffix (the same
// honesty affordance AssetValueChart uses). The title renders even with no
// data, so seeding empty stores is enough to assert the suffix.
function seedTwoPersons() {
  const noop = async () => {};
  usePersonsStore.setState({
    persons: [{ id: 1, name: 'Alex' } as never, { id: 2, name: 'Sam' } as never],
    isLoading: false, error: null, load: noop,
  } as never);
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: noop } as never);
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: noop } as never);
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null, load: noop } as never);
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: noop } as never);
  useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], isLoading: false, error: null, load: noop } as never);
  useLoansStore.setState({ loans: [], isLoading: false, error: null, load: noop } as never);
}

describe('household-wide donut scope labels (W10 T7)', () => {
  beforeEach(seedTwoPersons);

  it('AssetsDonut flags household scope in the title under a person view', () => {
    render(<MemoryRouter initialEntries={['/net-worth?view=p1']}><AssetsDonut /></MemoryRouter>);
    expect(screen.getByText(/assets · household/i)).toBeInTheDocument();
  });

  it('AssetsDonut keeps the plain title in household view', () => {
    render(<MemoryRouter><AssetsDonut /></MemoryRouter>);
    expect(screen.queryByText(/· household/i)).not.toBeInTheDocument();
    expect(screen.getByText('Assets')).toBeInTheDocument();
  });

  it('LiabilitiesDonut flags household scope in the title under a person view', () => {
    render(<MemoryRouter initialEntries={['/net-worth?view=p1']}><LiabilitiesDonut /></MemoryRouter>);
    expect(screen.getByText(/liabilities · household/i)).toBeInTheDocument();
  });
});
