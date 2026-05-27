import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VehiclePreviewTable } from '@/components/import/VehiclePreviewTable';
import { createImportPreviewStore, type ImportPreviewState } from '@/stores/import-preview-store';
import { useStore } from 'zustand';

function setup(rows: Array<Record<string, string>>) {
  return createImportPreviewStore(
    'vehicle',
    { headers: Object.keys(rows[0] ?? {}), rows, errors: [] },
    {
      accounts: [],
      persons: [{ id: 1, name: 'Alice' }],
      categories: [],
      properties: [],
      vehicles: [],
    },
  );
}

function Render({ store }: { store: ReturnType<typeof setup> }) {
  const state = useStore(store);
  return <VehiclePreviewTable state={state as ImportPreviewState<'vehicle'>} />;
}

describe('VehiclePreviewTable', () => {
  it('renders the Make/Model/Year column header', () => {
    const store = setup([
      { name: 'Daily', current_estimated_value: '18000', year: '2020', make: 'Toyota', model: 'Camry' },
    ]);
    render(<Render store={store} />);
    expect(screen.getByText(/Make \/ Model \/ Year/)).toBeInTheDocument();
    expect(screen.getByText(/2020 Toyota Camry/)).toBeInTheDocument();
  });

  it('shows error rows', () => {
    const store = setup([
      { name: '', current_estimated_value: '-1', year: '99' },
    ]);
    render(<Render store={store} />);
    expect(screen.getByText(/Name is required/)).toBeInTheDocument();
  });
});
