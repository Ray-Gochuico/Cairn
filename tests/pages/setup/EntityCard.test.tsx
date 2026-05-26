import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EntityCard from '@/pages/setup/EntityCard';

describe('EntityCard', () => {
  it('renders title, description, and count', () => {
    render(
      <EntityCard
        title="Accounts"
        description="Checking, savings, brokerage, etc."
        count={0}
        onAddManual={() => {}}
      />,
    );
    expect(screen.getByText('Accounts')).toBeInTheDocument();
    expect(
      screen.getByText(/Checking, savings, brokerage, etc./),
    ).toBeInTheDocument();
    expect(screen.getByText(/0 added/i)).toBeInTheDocument();
  });

  it('shows the Skip button when count is 0', () => {
    render(
      <EntityCard
        title="t"
        description="d"
        count={0}
        onAddManual={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: /skip — i don't have any/i }),
    ).toBeInTheDocument();
  });

  it('hides the Skip button when count > 0', () => {
    render(
      <EntityCard
        title="t"
        description="d"
        count={3}
        onAddManual={() => {}}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /skip — i don't have any/i }),
    ).toBeNull();
  });

  it('collapses to compact strip when skipped via the Skip button', async () => {
    const user = userEvent.setup();
    render(
      <EntityCard
        title="Accounts"
        description="d"
        count={0}
        onAddManual={() => {}}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: /skip — i don't have any/i }),
    );
    expect(screen.getByText(/Accounts \(skipped\)/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /add manually/i }),
    ).toBeNull();
  });

  it('un-skips when the restore button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <EntityCard
        title="Accounts"
        description="d"
        count={0}
        onAddManual={() => {}}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: /skip — i don't have any/i }),
    );
    await user.click(
      screen.getByRole('button', { name: /un-skip|restore/i }),
    );
    expect(
      screen.getByRole('button', { name: /add manually/i }),
    ).toBeInTheDocument();
  });

  it('calls onAddManual when Add manually is clicked', async () => {
    const user = userEvent.setup();
    const onAddManual = vi.fn();
    render(
      <EntityCard
        title="t"
        description="d"
        count={0}
        onAddManual={onAddManual}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: /add manually/i }),
    );
    expect(onAddManual).toHaveBeenCalledOnce();
  });

  it('renders a disabled "Import CSV (coming soon)" button by default', () => {
    render(
      <EntityCard
        title="t"
        description="d"
        count={0}
        onAddManual={() => {}}
      />,
    );
    const btn = screen.getByRole('button', {
      name: /import csv \(coming soon\)/i,
    });
    expect(btn).toBeDisabled();
  });

  it('renders an enabled "Import CSV" button when importEnabled is true and importTrigger is provided', () => {
    const importTrigger = <button type="button">Import CSV</button>;
    render(
      <EntityCard
        title="t"
        description="d"
        count={0}
        onAddManual={() => {}}
        importEnabled
        importTrigger={importTrigger}
      />,
    );
    const btn = screen.getByRole('button', { name: /^import csv$/i });
    expect(btn).not.toBeDisabled();
  });
});
