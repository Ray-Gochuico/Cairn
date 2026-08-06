import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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

  describe('created-entity chips (items prop)', () => {
    it('renders each item label as a chip in a container with a title-derived testid', () => {
      render(
        <EntityCard
          title="Accounts"
          description="d"
          count={2}
          onAddManual={() => {}}
          items={[
            { key: 1, label: 'Fidelity Brokerage' },
            { key: 2, label: 'Chase Checking' },
          ]}
        />,
      );
      const chips = screen.getByTestId('accounts-chips');
      expect(within(chips).getByText('Fidelity Brokerage')).toBeInTheDocument();
      expect(within(chips).getByText('Chase Checking')).toBeInTheDocument();
    });

    it('slugifies multi-word titles for the testid', () => {
      render(
        <EntityCard
          title="Rent / housing payment"
          description="d"
          count={1}
          onAddManual={() => {}}
          items={[{ key: 1, label: 'Apartment rent' }]}
        />,
      );
      expect(
        within(screen.getByTestId('rent-housing-payment-chips')).getByText(
          'Apartment rent',
        ),
      ).toBeInTheDocument();
    });

    it('honors an explicit itemsTestId override (persons keep person-chips)', () => {
      render(
        <EntityCard
          title="Persons"
          description="d"
          count={1}
          onAddManual={() => {}}
          items={[{ key: 1, label: 'Alice' }]}
          itemsTestId="person-chips"
        />,
      );
      expect(
        within(screen.getByTestId('person-chips')).getByText('Alice'),
      ).toBeInTheDocument();
    });

    it('renders no chip container when items is empty or undefined (no false empty state)', () => {
      const { unmount } = render(
        <EntityCard
          title="Accounts"
          description="d"
          count={0}
          onAddManual={() => {}}
          items={[]}
        />,
      );
      expect(screen.queryByTestId('accounts-chips')).toBeNull();
      unmount();
      render(
        <EntityCard title="Accounts" description="d" count={0} onAddManual={() => {}} />,
      );
      expect(screen.queryByTestId('accounts-chips')).toBeNull();
    });

    it('renders edit/remove buttons only when handlers are provided, and wires them', async () => {
      const user = userEvent.setup();
      const onEdit = vi.fn();
      const onRemove = vi.fn();
      render(
        <EntityCard
          title="Persons"
          description="d"
          count={2}
          onAddManual={() => {}}
          items={[
            { key: 1, label: 'Alice', onEdit, onRemove },
            { key: 2, label: 'Bob' },
          ]}
          itemsTestId="person-chips"
        />,
      );
      const chips = screen.getByTestId('person-chips');
      await user.click(within(chips).getByRole('button', { name: 'Edit Alice' }));
      expect(onEdit).toHaveBeenCalledOnce();
      await user.click(within(chips).getByRole('button', { name: 'Remove Alice' }));
      expect(onRemove).toHaveBeenCalledOnce();
      // Read-only chip: no controls at all.
      expect(within(chips).queryByRole('button', { name: /edit bob/i })).toBeNull();
      expect(within(chips).queryByRole('button', { name: /remove bob/i })).toBeNull();
    });

    it('exposes the full label as a title attribute so truncated long names stay reachable', () => {
      const long = 'A'.repeat(100);
      render(
        <EntityCard
          title="Accounts"
          description="d"
          count={1}
          onAddManual={() => {}}
          items={[{ key: 1, label: long }]}
        />,
      );
      const label = within(screen.getByTestId('accounts-chips')).getByText(long);
      expect(label).toHaveAttribute('title', long);
      expect(label.className).toMatch(/truncate/);
    });
  });

  it('Wave C N7: manage link renders bottom-right when provided (the Spending-link precedent, generalized)', () => {
    render(
      <MemoryRouter>
        <EntityCard title="Accounts" description="d" count={2} onAddManual={() => {}}
          manageHref="/investments?manage=accounts" manageLabel="Manage on Investments page" />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Manage on Investments page →' });
    expect(link).toHaveAttribute('href', '/investments?manage=accounts');
  });

  it('Wave C N7: no link without the props (existing renders untouched)', () => {
    render(<EntityCard title="X" description="d" count={0} onAddManual={() => {}} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('Wave C C5: countLabel replaces "{count} added" with a value-bearing caption', () => {
    render(
      <EntityCard
        title="Household"
        description="d"
        count={1}
        countLabel="Married filing jointly · CA · $8,000/mo baseline"
        onAddManual={() => {}}
      />,
    );
    expect(
      screen.getByText('Married filing jointly · CA · $8,000/mo baseline'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/1 added/)).not.toBeInTheDocument();
  });
});
