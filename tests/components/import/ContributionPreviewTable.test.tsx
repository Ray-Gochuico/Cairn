import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContributionPreviewTable } from '@/components/import/ContributionPreviewTable';
import { createImportPreviewStore, type ImportPreviewState } from '@/stores/import-preview-store';
import { useStore } from 'zustand';
import { ContributionSource } from '@/types/enums';

function setup(rows: Array<Record<string, string>>, opts: { dups?: Set<string> } = {}) {
  return createImportPreviewStore(
    'contribution',
    { headers: Object.keys(rows[0] ?? {}), rows, errors: [] },
    {
      accounts: [{ id: 10, name: 'Brokerage' }],
      persons: [{ id: 1, name: 'Alice' }],
      categories: [],
      properties: [],
      vehicles: [],
      existingContributionDupKeys: opts.dups,
    },
  );
}

function Render({ store }: { store: ReturnType<typeof setup> }) {
  const state = useStore(store);
  return <ContributionPreviewTable state={state as ImportPreviewState<'contribution'>} />;
}

describe('ContributionPreviewTable', () => {
  it('renders amount and source columns', () => {
    const store = setup([
      {
        account_name: 'Brokerage',
        contribution_date: '2026-01-15',
        amount: '500',
        source: ContributionSource.MANUAL,
      },
    ]);
    render(<Render store={store} />);
    expect(screen.getByText(/\$500/)).toBeInTheDocument();
  });

  it('renders DUPLICATE badge + a conflict selector when source key matches', () => {
    const dups = new Set<string>();
    dups.add('10::2026-01-15::500');
    const store = setup(
      [
        {
          account_name: 'Brokerage',
          contribution_date: '2026-01-15',
          amount: '500',
          source: ContributionSource.MANUAL,
        },
      ],
      { dups },
    );
    render(<Render store={store} />);
    expect(screen.getByText('DUPLICATE')).toBeInTheDocument();
    // The duplicate row exposes a Skip/Insert select.
    expect(screen.getByRole('option', { name: 'Skip' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Insert' })).toBeInTheDocument();
  });
});
