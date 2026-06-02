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

  it('does NOT render a per-card "Skip — I don\'t have any" control (H2: removed)', () => {
    // The per-card skip was cosmetic (local state only) and reset on remount,
    // lying on re-entry. It was removed; the empty "0 added" state communicates
    // emptiness, and the section-level skip is the persisted one.
    render(
      <EntityCard
        title="t"
        description="d"
        count={0}
        onAddManual={() => {}}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /skip — i don't have any/i }),
    ).toBeNull();
  });

  it('keeps the card fully rendered at count 0 (no collapse-to-strip)', () => {
    render(
      <EntityCard
        title="Accounts"
        description="d"
        count={0}
        onAddManual={() => {}}
      />,
    );
    // The empty state still shows the actionable card, not a "(skipped)" strip.
    expect(screen.queryByText(/\(skipped\)/i)).toBeNull();
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

  it('renders a plain disabled "Import CSV" button by default (no importer)', () => {
    render(
      <EntityCard
        title="t"
        description="d"
        count={0}
        onAddManual={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /^import csv$/i });
    expect(btn).toBeDisabled();
    // The overpromising "coming soon" copy is gone.
    expect(screen.queryByText(/coming soon/i)).toBeNull();
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

  it('disables the import button and shows the reason when importDisabledReason is set', () => {
    const importTrigger = <button type="button">Import CSV (live)</button>;
    render(
      <EntityCard
        title="Holdings"
        description="d"
        count={0}
        onAddManual={() => {}}
        importEnabled
        importTrigger={importTrigger}
        importDisabledReason="Add an account first — imports match rows to existing accounts by name."
      />,
    );
    // The live import trigger is NOT rendered…
    expect(screen.queryByRole('button', { name: /^import csv \(live\)$/i })).toBeNull();
    // …a disabled placeholder is shown instead…
    const disabled = screen.getByRole('button', { name: /import csv/i });
    expect(disabled).toBeDisabled();
    // …and the inline reason is visible.
    expect(
      screen.getByText(/imports match rows to existing accounts by name/i),
    ).toBeInTheDocument();
  });

  it('links the disabled import button to its reason via aria-describedby (L1)', () => {
    render(
      <EntityCard
        title="Holdings"
        description="d"
        count={0}
        onAddManual={() => {}}
        importEnabled
        importTrigger={<button type="button">Import CSV (live)</button>}
        importDisabledReason="Add an account first."
      />,
    );
    const disabled = screen.getByRole('button', { name: /import csv/i });
    const describedBy = disabled.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const note = screen.getByRole('note');
    expect(note).toHaveAttribute('id', describedBy);
    expect(note).toHaveTextContent(/add an account first/i);
  });

  it('renders the live import trigger when importDisabledReason is absent', () => {
    const importTrigger = <button type="button">Import CSV</button>;
    render(
      <EntityCard
        title="Holdings"
        description="d"
        count={0}
        onAddManual={() => {}}
        importEnabled
        importTrigger={importTrigger}
      />,
    );
    expect(screen.getByRole('button', { name: /^import csv$/i })).not.toBeDisabled();
    expect(
      screen.queryByText(/imports match rows to existing accounts by name/i),
    ).toBeNull();
  });
});
