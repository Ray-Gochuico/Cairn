import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BudgetCategoryPicker from '@/components/budget/BudgetCategoryPicker';

type Option = { id: number; name: string };

const opts: Option[] = [
  { id: 1, name: 'Groceries' },
  { id: 2, name: 'Gas/Fuel' },
  { id: 3, name: 'Coffee' },
];

describe('BudgetCategoryPicker', () => {
  it('renders nothing of substance when there are no untracked categories', () => {
    render(<BudgetCategoryPicker untracked={[]} onConfirm={() => {}} />);
    // No trigger button should be visible when there's nothing to add.
    expect(screen.queryByRole('button', { name: /add categor/i })).not.toBeInTheDocument();
  });

  it('shows a trigger button and opens a picker listing each untracked category', async () => {
    const user = userEvent.setup();
    render(<BudgetCategoryPicker untracked={opts} onConfirm={() => {}} />);

    const trigger = screen.getByRole('button', { name: /add categor/i });
    await user.click(trigger);

    // Every untracked category appears as a checkbox row.
    expect(screen.getByRole('checkbox', { name: 'Groceries' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Gas/Fuel' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Coffee' })).toBeInTheDocument();
  });

  it('calls onConfirm with all checked ids when the apply button is clicked', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<BudgetCategoryPicker untracked={opts} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: /add categor/i }));
    await user.click(screen.getByRole('checkbox', { name: 'Groceries' }));
    await user.click(screen.getByRole('checkbox', { name: 'Gas/Fuel' }));
    await user.click(screen.getByRole('checkbox', { name: 'Coffee' }));

    // Apply button now reads "Add 3 categories".
    const apply = screen.getByRole('button', { name: /add 3 categor/i });
    await user.click(apply);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Order is the order they were selected in (here matches list order).
    const arg = (onConfirm.mock.calls[0]?.[0] ?? []) as number[];
    expect(arg.sort()).toEqual([1, 2, 3]);
  });

  it('apply button reflects the selected count and is disabled with no selection', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<BudgetCategoryPicker untracked={opts} onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: /add categor/i }));

    // With nothing selected the apply button reads "Add 0 categories" and is disabled.
    const apply = screen.getByRole('button', { name: /add 0 categor/i });
    expect(apply).toBeDisabled();

    // Check one and the label updates to "Add 1 category", enabled.
    await user.click(screen.getByRole('checkbox', { name: 'Coffee' }));
    expect(screen.getByRole('button', { name: /add 1 categor/i })).toBeEnabled();
  });

  it('opening, checking, then closing without clicking Apply does not call onConfirm and clears selection', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<BudgetCategoryPicker untracked={opts} onConfirm={onConfirm} />);

    // Open, check Groceries, close via the close button.
    await user.click(screen.getByRole('button', { name: /add categor/i }));
    await user.click(screen.getByRole('checkbox', { name: 'Groceries' }));

    // Close. The Dialog primitive renders a "Close" button (sr-only label).
    const closeBtn = screen.getByRole('button', { name: /^close$/i });
    await user.click(closeBtn);
    expect(onConfirm).not.toHaveBeenCalled();

    // Re-open and confirm the previously checked box is unchecked (state cleared).
    await user.click(screen.getByRole('button', { name: /add categor/i }));
    const cb = screen.getByRole('checkbox', { name: 'Groceries' }) as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it('unchecking a category removes it from the selection count', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<BudgetCategoryPicker untracked={opts} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: /add categor/i }));
    await user.click(screen.getByRole('checkbox', { name: 'Groceries' }));
    await user.click(screen.getByRole('checkbox', { name: 'Gas/Fuel' }));
    expect(screen.getByRole('button', { name: /add 2 categor/i })).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Groceries' })); // uncheck
    expect(screen.getByRole('button', { name: /add 1 categor/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add 1 categor/i }));
    expect(onConfirm).toHaveBeenCalledWith([2]);
  });
});
