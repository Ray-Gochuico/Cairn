import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PropertyPreviewTable } from '@/components/import/PropertyPreviewTable';
import { createImportPreviewStore, type ImportPreviewState } from '@/stores/import-preview-store';
import { useStore } from 'zustand';
import { PropertyType } from '@/types/enums';

function setup(rows: Array<Record<string, string>>) {
  return createImportPreviewStore(
    'property',
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
  return <PropertyPreviewTable state={state as ImportPreviewState<'property'>} />;
}

describe('PropertyPreviewTable', () => {
  it('renders rows and the Est. value column', () => {
    const store = setup([
      { name: 'Main', type: PropertyType.PRIMARY_RESIDENCE, current_estimated_value: '750000' },
    ]);
    render(<Render store={store} />);
    expect(screen.getByText('Main')).toBeInTheDocument();
    expect(screen.getByText('Est. value')).toBeInTheDocument();
    expect(screen.getByText(/\$750,000/)).toBeInTheDocument();
  });

  it('shows error rows', () => {
    const store = setup([
      { name: '', type: 'NONE', current_estimated_value: '-1' },
    ]);
    render(<Render store={store} />);
    expect(screen.getByText(/Name is required/)).toBeInTheDocument();
  });
});
