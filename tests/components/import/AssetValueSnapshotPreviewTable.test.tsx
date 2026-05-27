import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssetValueSnapshotPreviewTable } from '@/components/import/AssetValueSnapshotPreviewTable';
import { createImportPreviewStore, type ImportPreviewState } from '@/stores/import-preview-store';
import { useStore } from 'zustand';
import { AssetSnapshotOwnerType } from '@/types/enums';

function setup(rows: Array<Record<string, string>>) {
  return createImportPreviewStore(
    'asset_value_snapshot',
    { headers: Object.keys(rows[0] ?? {}), rows, errors: [] },
    {
      accounts: [],
      persons: [],
      categories: [],
      properties: [{ id: 5, name: 'Main Residence' }],
      vehicles: [{ id: 9, name: 'Daily Driver' }],
    },
  );
}

function Render({ store }: { store: ReturnType<typeof setup> }) {
  const state = useStore(store);
  return <AssetValueSnapshotPreviewTable state={state as ImportPreviewState<'asset_value_snapshot'>} />;
}

describe('AssetValueSnapshotPreviewTable', () => {
  it('renders rows + the Owner type / Owner name column headers', () => {
    const store = setup([
      {
        owner_type: AssetSnapshotOwnerType.PROPERTY,
        owner_name: 'Main Residence',
        snapshot_date: '2026-04-30',
        value: '765000',
      },
    ]);
    render(<Render store={store} />);
    expect(screen.getByText('Owner type')).toBeInTheDocument();
    expect(screen.getByText('Owner name')).toBeInTheDocument();
    expect(screen.getByText('Main Residence')).toBeInTheDocument();
    expect(screen.getByText(/\$765,000/)).toBeInTheDocument();
  });

  it('shows error rows', () => {
    const store = setup([
      { owner_type: 'BAD', owner_name: 'X', snapshot_date: 'bad', value: '-1' },
    ]);
    render(<Render store={store} />);
    expect(screen.getByText(/Unknown owner type/)).toBeInTheDocument();
  });
});
